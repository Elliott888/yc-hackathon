"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  GlobeIcon,
  ImageIcon,
  MessageCircleDashedIcon,
  PaperclipIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon,
  TelescopeIcon,
} from "lucide-react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}

export function Chat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "streaming" | "error">(
    "idle"
  );
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isBusy = status === "streaming";
  const canSend = input.trim().length > 0 && !isBusy;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = input.trim();

    if (!prompt || isBusy) {
      return;
    }

    const userMessage = createMessage("user", prompt);
    const assistantMessage = createMessage("assistant", "");
    const nextMessages = [...messages, userMessage, assistantMessage];

    setMessages(nextMessages);
    setInput("");
    setStatus("streaming");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(({ role, content }) => ({
            role,
            content,
          })),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(error?.error ?? "The request failed.");
      }

      if (!response.body) {
        throw new Error("The response did not include a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: message.content + chunk }
              : message
          )
        );
      }

      setStatus("idle");
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("idle");
        return;
      }

      const message =
        error instanceof Error ? error.message : "The request failed.";

      setStatus("error");
      setMessages((currentMessages) =>
        currentMessages.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, content: `Request failed: ${message}` }
            : item
        )
      );
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleReset() {
    abortControllerRef.current?.abort();
    setMessages([]);
    setInput("");
    setStatus("idle");
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    setStatus("idle");
  }

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <MessageScrollerProvider autoScroll>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-6">
        <Card className="h-140 w-full max-w-sm gap-0">
          <CardHeader className="gap-1 border-b">
            <CardTitle>Streaming Messages</CardTitle>
            <CardDescription>
              Auto-scroll follows the live edge of the conversation.
            </CardDescription>
            <CardAction>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Reset chat"
                      disabled={messages.length === 0 && !isBusy}
                      onClick={handleReset}
                    />
                  }
                >
                  <RotateCwIcon />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset</p>
                </TooltipContent>
              </Tooltip>
            </CardAction>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            {messages.length === 0 ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageCircleDashedIcon />
                  </EmptyMedia>
                  <EmptyTitle>Ready to Stream</EmptyTitle>
                  <EmptyDescription>
                    Ask a question to stream a live response from OpenAI.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    aria-busy={isBusy}
                    className="p-(--card-spacing)"
                  >
                    {messages.map((message) => (
                      <MessageAnimated
                        key={message.id}
                        message={message}
                        isBusy={isBusy}
                      />
                    ))}
                    {isBusy ? (
                      <MessageScrollerItem scrollAnchor={false}>
                        <Marker role="status">
                          <MarkerIcon>
                            <Spinner />
                          </MarkerIcon>
                          <MarkerContent>Streaming response...</MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-2">
            <form onSubmit={handleSubmit} className="w-full">
              <InputGroup>
                <InputGroupTextarea
                  aria-label="Message"
                  placeholder="Ask me anything..."
                  className="h-14 min-h-14 overflow-y-auto"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  disabled={isBusy}
                />
                <InputGroupAddon align="block-end" className="pt-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <InputGroupButton
                          aria-label="Add files"
                          type="button"
                          size="icon-sm"
                          variant="outline"
                        />
                      }
                    >
                      <PlusIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="w-44"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <PaperclipIcon />
                          Add Photos & Files
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <ImageIcon />
                          Create Image
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <TelescopeIcon />
                          Deep Research
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <GlobeIcon />
                          Web Search
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {isBusy ? (
                    <InputGroupButton
                      type="button"
                      size="icon-sm"
                      className="ml-auto"
                      onClick={handleStop}
                    >
                      <SquareIcon />
                      <span className="sr-only">Stop</span>
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      type="submit"
                      variant="default"
                      size="icon-sm"
                      disabled={!canSend}
                      className="ml-auto"
                    >
                      <ArrowUpIcon />
                      <span className="sr-only">Send</span>
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </form>
            <div className="px-0.5 text-center text-xs text-muted-foreground">
              Streaming uses the OpenAI Responses API. `autoScroll` is enabled.
            </div>
            {status === "error" ? (
              <p className="text-center text-xs text-destructive">
                The last request failed. Check your API key, model access, or
                network.
              </p>
            ) : null}
          </CardFooter>
        </Card>
      </div>
    </MessageScrollerProvider>
  );
}

function MessageAnimated({
  message,
  isBusy,
}: {
  message: ChatMessage;
  isBusy: boolean;
}) {
  const isUser = message.role === "user";
  const isEmptyStreamingAssistant =
    !isUser && isBusy && message.content.length === 0;

  return (
    <MessageScrollerItem
      messageId={message.id}
      scrollAnchor={message.role === "user"}
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <Message align={isUser ? "end" : "start"}>
        <MessageContent>
          <Bubble variant={isUser ? "default" : "muted"}>
            <BubbleContent className="whitespace-pre-wrap">
              {isEmptyStreamingAssistant ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden="true" />
                  Thinking...
                </span>
              ) : (
                message.content
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

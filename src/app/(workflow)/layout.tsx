import { WorkflowProvider } from "@/components/chat";

export default function WorkflowLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <WorkflowProvider>{children}</WorkflowProvider>;
}

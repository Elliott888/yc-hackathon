export function formatCliError(error) {
  if (error?.status === 403) {
    return [
      "GitHub returned 403 while harvesting.",
      "Set GITHUB_TOKEN for live runs or lower --limit/--max-users if you are testing without authentication.",
      `Original error: ${error.message}`
    ].join("\n");
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

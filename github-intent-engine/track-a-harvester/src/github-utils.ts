export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo full name: ${fullName}`);
  }

  return { owner: parts[0], repo: parts[1] };
}

export function isAtOrAfter(value: string | null | undefined, since: Date): boolean {
  if (!value) {
    return false;
  }
  return Date.parse(value) >= since.getTime();
}

export function parseIssueNumberFromIssueUrl(issueUrl: string | null | undefined): number | null {
  if (!issueUrl) {
    return null;
  }

  const match = issueUrl.match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

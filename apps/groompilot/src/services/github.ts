import { Octokit } from "@octokit/rest";

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function getStory(token: string, owner: string, repo: string, issueNumber: number) {
  const octokit = createOctokit(token);
  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  const { data: comments } = await octokit.issues.listComments({
    owner, repo, issue_number: issueNumber, per_page: 50,
  });
  return { issue, comments };
}

export async function getRepoIssues(token: string, owner: string, repo: string) {
  const octokit = createOctokit(token);
  const { data } = await octokit.issues.listForRepo({
    owner, repo, state: "open", per_page: 100, sort: "updated",
  });
  return data;
}

export async function getUserRepos(token: string) {
  const octokit = createOctokit(token);
  // Fetch user's own repos + repos from orgs they belong to
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort: "updated", per_page: 100, affiliation: "owner,collaborator,organization_member",
  });
  return data;
}

export async function getPRDiff(token: string, owner: string, repo: string, prNumber: number) {
  const octokit = createOctokit(token);
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const { data: files } = await octokit.pulls.listFiles({
    owner, repo, pull_number: prNumber, per_page: 100,
  });
  return { pr, files };
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<string> {
  const octokit = createOctokit(token);
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref,
  });

  if (Array.isArray(data) || data.type !== "file" || !data.content) {
    return "";
  }

  return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
}

export async function getLabels(token: string, owner: string, repo: string) {
  const octokit = createOctokit(token);
  const { data } = await octokit.issues.listLabelsForRepo({ owner, repo });
  return data;
}

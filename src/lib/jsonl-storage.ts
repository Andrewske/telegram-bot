import { Octokit } from '@octokit/rest';
import dayjs from 'dayjs';

let octokit: Octokit | null = null;

function getGitHubClient(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    octokit = new Octokit({
      auth: token,
    });
  }

  return octokit;
}

export async function appendToJsonl(
  filePath: string,
  entry: Record<string, any>
): Promise<void> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  const newLine = JSON.stringify(entry);

  try {
    // Try to get existing file
    let currentContent = '';
    let sha: string | undefined;

    try {
      const { data } = await client.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if ('content' in data && typeof data.content === 'string') {
        currentContent = Buffer.from(data.content, 'base64').toString('utf-8');
        sha = data.sha;
      }
    } catch (error: any) {
      if (error.status === 404) {
        // File doesn't exist yet, create it
        currentContent = '';
        console.log(`Creating new JSONL file: ${filePath}`);
      } else {
        throw error;
      }
    }

    // Append new line
    const updatedContent = currentContent.trim() + (currentContent.trim() ? '\n' : '') + newLine + '\n';

    // Create or update file
    await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Add entry to ${filePath}`,
      content: Buffer.from(updatedContent).toString('base64'),
      sha,
    });

    console.log(`Appended to JSONL file ${filePath}: ${newLine}`);
  } catch (error) {
    console.error('Failed to append to JSONL file:', error);
    throw error;
  }
}

export async function updateJsonlEntry(
  filePath: string,
  messageId: number,
  newFields: Record<string, any>
): Promise<boolean> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  try {
    // Get existing file
    const { data } = await client.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    if (!('content' in data) || typeof data.content !== 'string') {
      throw new Error(`File ${filePath} not found or invalid format`);
    }

    const currentContent = Buffer.from(data.content, 'base64').toString('utf-8');
    const lines = currentContent.trim().split('\n').filter(line => line.trim());

    // Find and update the line with matching message_id
    let updated = false;
    const updatedLines = lines.map(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.message_id === messageId) {
          // Merge new fields into existing entry
          const updatedEntry = { ...entry, ...newFields };
          updated = true;
          return JSON.stringify(updatedEntry);
        }
        return line;
      } catch (error) {
        // If line can't be parsed as JSON, leave it as is
        console.warn(`Invalid JSON line in ${filePath}: ${line}`);
        return line;
      }
    });

    if (!updated) {
      console.log(`No entry found with message_id ${messageId} in ${filePath}`);
      return false;
    }

    // Write updated content back
    const updatedContent = updatedLines.join('\n') + '\n';

    await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Update entry ${messageId} in ${filePath}`,
      content: Buffer.from(updatedContent).toString('base64'),
      sha: data.sha,
    });

    console.log(`Updated entry ${messageId} in JSONL file ${filePath}`);
    return true;
  } catch (error: any) {
    if (error.status === 404) {
      console.log(`File ${filePath} not found for update`);
      return false;
    }
    console.error('Failed to update JSONL entry:', error);
    throw error;
  }
}

export async function uploadFile(
  filePath: string,
  fileBuffer: Buffer,
  commitMessage: string
): Promise<string> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  try {
    // Upload file to GitHub
    await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: commitMessage,
      content: fileBuffer.toString('base64'),
    });

    console.log(`Uploaded file to GitHub: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Failed to upload file to GitHub:', error);
    throw error;
  }
}

export function generateMonthlyFilePath(basePath: string, date: Date): string {
  const monthStr = dayjs(date).format('YYYY-MM');
  return `${basePath}/${monthStr}.jsonl`;
}
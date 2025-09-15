import { Octokit } from '@octokit/rest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

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

    console.log('GitHub client initialized');
  }

  return octokit;
}

export async function appendToDaily(
  date: string,
  content: string,
  userTimezone: string = 'America/Los_Angeles'
): Promise<void> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  const path = `daily/${date}.md`;
  const timestamp = dayjs().tz(userTimezone).format('HH:mm');
  const newLine = `- [${timestamp}] ${content}`;

  try {
    // Try to get existing file
    let currentContent = '';
    let sha: string | undefined;

    try {
      const { data } = await client.repos.getContent({
        owner,
        repo,
        path,
      });

      if ('content' in data && typeof data.content === 'string') {
        currentContent = Buffer.from(data.content, 'base64').toString('utf-8');
        sha = data.sha;
      }
    } catch (error: any) {
      if (error.status === 404) {
        // File doesn't exist yet, create it
        currentContent = `# ${date}\n\n`;
        console.log(`Creating new daily file: ${path}`);
      } else {
        throw error;
      }
    }

    // Append new content
    const updatedContent = currentContent.trim() + (currentContent.trim() ? '\n' : '') + newLine + '\n';

    // Create or update file
    await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Update daily note for ${date}`,
      content: Buffer.from(updatedContent).toString('base64'),
      sha, // Include SHA if updating existing file
    });

    console.log(`Appended to daily file ${path}: ${newLine}`);
  } catch (error) {
    console.error('Failed to append to daily file:', error);
    throw error;
  }
}

export async function uploadPhoto(
  photoBuffer: Buffer,
  filename: string
): Promise<string> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  const path = `attachments/${filename}`;

  try {
    // Upload photo to GitHub
    await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Add photo: ${filename}`,
      content: photoBuffer.toString('base64'),
    });

    console.log(`Uploaded photo to GitHub: ${path}`);

    // Return the relative path for markdown
    return path;
  } catch (error) {
    console.error('Failed to upload photo to GitHub:', error);
    throw error;
  }
}

export function generatePhotoMarkdown(filename: string, caption?: string): string {
  const description = caption || 'Photo';
  // Use relative path from daily folder to attachments folder
  return `![${description}](../attachments/${filename})`;
}

// Initialize the client on module load to fail fast
export async function initializeGitHub(): Promise<void> {
  const client = getGitHubClient();
  const owner = process.env.GITHUB_OWNER || process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables are required');
  }

  try {
    // Test access to the repository
    await client.repos.get({ owner, repo });
    console.log(`✅ GitHub repository access confirmed: ${owner}/${repo}`);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found. Please create it first.`);
    } else if (error.status === 401) {
      throw new Error('Invalid GitHub token. Please check your GITHUB_TOKEN.');
    }
    throw error;
  }
}
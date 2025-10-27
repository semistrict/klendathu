/**
 * Example: Basic error debugging with klendathu
 *
 * This demonstrates how to use klendathu to investigate a runtime error.
 */

import { investigate } from 'klendathu';

interface User {
  id: string;
  name: string;
  email?: string;
}

interface ApiResponse {
  user?: User;
  status: string;
}

async function fetchUserData(userId: string): Promise<ApiResponse> {
  // Simulate API response
  return {
    status: 'success',
    // Oops! Forgot to include user data
  };
}

async function processUser(userId: string) {
  const response = await fetchUserData(userId);

  // This will throw because response.user is undefined
  const userName = response.user.name;
  const userEmail = response.user.email || 'no-email@example.com';

  console.log(`Processing user: ${userName} (${userEmail})`);
}

async function main() {
  const userId = 'user-123';

  try {
    await processUser(userId);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error occurred:', error.message);

      // Investigate with Claude - provide error and local context
      // Claude will be able to inspect the error and the userId variable
      console.log("Investigation: ", await investigate({ error, userId }));
      throw error; // Re-throw after investigation
    }
  }
}

main().catch(console.error);

// Test app with intentional bugs for Playwright testing

let counter = 0;

// Bug 1: Off-by-one error in counter increment
document.getElementById('increment').addEventListener('click', () => {
  counter = counter + 2; // BUG: Should increment by 1, not 2
  document.getElementById('counter').textContent = counter;
});

// Bug 2: Missing property access causes undefined
document.getElementById('fetch-data').addEventListener('click', async () => {
  const userData = {
    name: 'Alice',
    // BUG: Missing 'email' property
  };

  const email = userData.email; // This will be undefined
  document.getElementById('user-info').textContent = `Email: ${email}`;
});

// Bug 3: Division by zero
document.getElementById('calculate').addEventListener('click', () => {
  const numerator = 100;
  const denominator = 0; // BUG: Division by zero
  const result = numerator / denominator;
  document.getElementById('calculation-result').textContent = `Result: ${result}`;
});

// Bug 4: Form submission with dynamically renamed input
document.getElementById('submit-form').addEventListener('click', () => {
  // Show the form
  const form = document.getElementById('registration-form');
  form.style.display = 'block';

  // BUG: Dynamically change the email input's ID after a short delay
  // This makes the input unfillable by its original ID
  setTimeout(() => {
    const emailInput = document.getElementById('email-input');
    if (emailInput) {
      emailInput.id = 'email-field-renamed';
    }
  }, 100);
});

document.getElementById('registration-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  // Try to get email from the renamed input
  const email = document.getElementById('email-field-renamed')?.value ||
                document.getElementById('email-input')?.value;

  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));

  document.getElementById('form-status').textContent = `Registered: ${username} (${email || 'undefined'})`;
});

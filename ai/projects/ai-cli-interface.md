# Step  1

Create a CLI for the script where i can define whether i wanna generate a new plan or recheck an existing one.

Let's use some lib for creating a nicer CLI interface.
Do not touch the tsconfig.

# Step 2

if the plan revalidation says the plan is obsolote, let's set its `progress` to `SKIPPED`;

# Step 3

if the plan can be traded, just need time for it, do not modify anything

# Step 4

Separate the Trading bot from the CLI, we can have a new service named `TradingBot` and keep the `index.ts` as an entry point to handle input parameters from the user.
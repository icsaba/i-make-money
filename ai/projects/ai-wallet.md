# Step 1

Create an `SMCWalletService` that can manage our money. It should have an initial value of 10k USD.
It should persist the data into the database, and keep track of active trades.

properties it should have

- `balance: number` default value 10000
- `position_size: number` default value is 20%

# Step 2

Define new table, named `Trades`

```ts
interface Trades {
    symbol: string;
    direction: string;
    entry: number;
    stopLoss: number;
    target: number;
    confidence: number;
    positionSize: number;
    profitLoss: number;
    timeframe: string;
    enterDate: Date;
    exitDate: Date;
    reason: string;
}
```

# Step 3

Add placeholder where we will call the 3rd party to place the order



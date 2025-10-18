# Alchemy Webhook GraphQL Queries (Updated with Transfer Events)

## ERC20 Transfer Event Topic
`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`

## Token Addresses
- **Ethereum OCEAN:** `0x967da4048cd07ab37855c090aaf366e4ce1b9f48`
- **Polygon mOCEAN:** `0x282d8efce846a88b159800bd4130ad77443fa1a1`

---

## 1. Uniswap V2 OCEAN/WETH (Ethereum)
**Pool Address:** `0x9b7dad79fc16106b47a3dab791f389c167e15eb0`

```graphql
{
  block {
    number
    hash
    timestamp
    logs(filter: {
      addresses: ["0x9b7dad79fc16106b47a3dab791f389c167e15eb0", "0x967da4048cd07ab37855c090aaf366e4ce1b9f48"],
      topics: [["0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]]
    }) {
      data
      topics
      index
      account {
        address
      }
      transaction {
        hash
        from {
          address
        }
        to {
          address
        }
        index
        value
        status
      }
    }
  }
}
```

---

## 2. Uniswap V3 OCEAN/WETH 0.3% (Ethereum)
**Pool Address:** `0x283e2e83b7f3e297c4b7c02114ab0196b001a109`

```graphql
{
  block {
    number
    hash
    timestamp
    logs(filter: {
      addresses: ["0x283e2e83b7f3e297c4b7c02114ab0196b001a109", "0x967da4048cd07ab37855c090aaf366e4ce1b9f48"],
      topics: [["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]]
    }) {
      data
      topics
      index
      account {
        address
      }
      transaction {
        hash
        from {
          address
        }
        to {
          address
        }
        index
        value
        status
      }
    }
  }
}
```

---

## 3. Uniswap V3 OCEAN/USDT 0.3% (Ethereum)
**Pool Address:** `0x98785fda382725d2d6b5022bf78b30eeaefdc387`

```graphql
{
  block {
    number
    hash
    timestamp
    logs(filter: {
      addresses: ["0x98785fda382725d2d6b5022bf78b30eeaefdc387", "0x967da4048cd07ab37855c090aaf366e4ce1b9f48"],
      topics: [["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]]
    }) {
      data
      topics
      index
      account {
        address
      }
      transaction {
        hash
        from {
          address
        }
        to {
          address
        }
        index
        value
        status
      }
    }
  }
}
```

---

## 4. Balancer V2 psdnOCEAN/OCEAN (Ethereum)
**Vault Address:** `0xba12222222228d8ba445958a75a0704d566bf2c8`
**Pool ID:** `0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b000200000000000000000000`

```graphql
{
  block {
    number
    hash
    timestamp
    logs(filter: {
      addresses: ["0xba12222222228d8ba445958a75a0704d566bf2c8", "0x967da4048cd07ab37855c090aaf366e4ce1b9f48"],
      topics: [["0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], ["0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b000200000000000000000000"]]
    }) {
      data
      topics
      index
      account {
        address
      }
      transaction {
        hash
        from {
          address
        }
        to {
          address
        }
        index
        value
        status
      }
    }
  }
}
```

---

## 5. QuickSwap OCEAN/WMATIC (Polygon)
**Pool Address:** `0x5a94f81d25c73eddbdd84b84e8f6d36c58270510`

```graphql
{
  block {
    number
    hash
    timestamp
    logs(filter: {
      addresses: ["0x5a94f81d25c73eddbdd84b84e8f6d36c58270510", "0x282d8efce846a88b159800bd4130ad77443fa1a1"],
      topics: [["0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]]
    }) {
      data
      topics
      index
      account {
        address
      }
      transaction {
        hash
        from {
          address
        }
        to {
          address
        }
        index
        value
        status
      }
    }
  }
}
```

---

## How to Update Webhooks

1. Go to Alchemy Dashboard → Notify → Custom Webhooks
2. For each webhook, click **Edit**
3. Replace the GraphQL query with the corresponding one above
4. Click **Save**

**Note:** The queries now include both:
- Swap events (original topic0)
- Transfer events (0xddf2...)

This allows us to match which wallet actually received the OCEAN tokens.


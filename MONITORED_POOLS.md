# Monitored Pools

This bot monitors OCEAN **BUY** transactions (when traders receive OCEAN from the pool).

## Currently Monitored

### Ethereum Mainnet (Chain ID: 1)

#### Uniswap v2
1. **OCEAN/WETH**
   - Address: `0x9b7dad79fc16106b47a3dab791f389c167e15eb0`
   - View on [Etherscan](https://etherscan.io/address/0x9b7dad79fc16106b47a3dab791f389c167e15eb0)

#### Uniswap v3
2. **OCEAN/WETH 0.3%**
   - Address: `0x283e2e83b7f3e297c4b7c02114ab0196b001a109`
   - The primary OCEAN liquidity pool on Ethereum
   - View on [Uniswap Info](https://info.uniswap.org/#/pools/0x283e2e83b7f3e297c4b7c02114ab0196b001a109)

3. **OCEAN/USDT 0.3%**
   - Address: `0x98785fda382725d2d6b5022bf78b30eeaefdc387`
   - View on [Uniswap Info](https://info.uniswap.org/#/pools/0x98785fda382725d2d6b5022bf78b30eeaefdc387)

#### Balancer v2
4. **psdnOCEAN/OCEAN**
   - Address: `0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b`
   - Pool ID: `0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b000200000000000000000000`
   - View on [Balancer](https://app.balancer.fi/#/ethereum/pool/0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b000200000000000000000000)

### Polygon (Chain ID: 137)

#### QuickSwap (Uniswap v2 Fork)
5. **mOCEAN/WMATIC**
   - Address: `0x5a94f81d25c73eddbdd84b84e8f6d36c58270510`
   - OCEAN Token: `0x282d8efce846a88b159800bd4130ad77443fa1a1`
   - TVL: ~$750K
   - View on [PolygonScan](https://polygonscan.com/address/0x5a94f81d25c73eddbdd84b84e8f6d36c58270510)

## How to Add More Pools

### Find OCEAN Pools

**Ethereum:**
- Uniswap: [OCEAN Token Page](https://info.uniswap.org/#/tokens/0x967da4048cd07ab37855c090aaf366e4ce1b9f48)
- Balancer: [OCEAN Token Page](https://app.balancer.fi/#/ethereum/tokens/0x967da4048cd07ab37855c090aaf366e4ce1b9f48)

**Polygon:**
- QuickSwap: [OCEAN Token Page](https://info.quickswap.exchange/#/token/0x282d8efce846a88b159800bd4130ad77443fa1a1)
- OCEAN Token: `0x282d8efce846a88b159800bd4130ad77443fa1a1`

**Other Chains:**
- Use DexScreener, DEX Guru, or chain-specific DEX explorers

### Add Pool to Code

Edit `src/config/pools.ts`:

#### Uniswap v2 Example (Ethereum/Polygon/BSC):
```typescript
{
  type: 'uniswap-v2',
  chainId: 137, // 1=Ethereum, 137=Polygon, 56=BSC
  chainName: 'Polygon',
  address: '0xYOUR_POOL_ADDRESS',
  token0: '0xTOKEN0_ADDRESS', // Sorted by address (lower first)
  token1: '0xTOKEN1_ADDRESS', // Sorted by address (higher second)
  label: 'QuickSwap OCEAN/WMATIC',
}
```

#### Uniswap v3 Example (Ethereum):
```typescript
{
  type: 'uniswap-v3',
  chainId: 1,
  chainName: 'Ethereum',
  address: '0xYOUR_POOL_ADDRESS',
  token0: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48', // OCEAN
  token1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  fee: 3000, // 0.3% = 3000, 0.05% = 500, 1% = 10000
  label: 'Uniswap v3 OCEAN/USDC 0.3%',
}
```

#### Balancer v2 Example (Ethereum):
```typescript
{
  type: 'balancer-v2',
  chainId: 1,
  chainName: 'Ethereum',
  poolId: '0xYOUR_POOL_ID_FROM_BALANCER', // 32 bytes
  address: '0xYOUR_POOL_ADDRESS',
  tokens: [
    '0x967da4048cd07ab37855c090aaf366e4ce1b9f48', // OCEAN
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  ],
  label: 'Balancer v2 OCEAN/USDC',
}
```

### Add to Webhook Provider (Moralis)

After adding to code, create a Moralis stream for the pool:

1. Go to [Moralis Streams Dashboard](https://admin.moralis.io/streams)
2. Click "Create New Stream"
3. Configure:
   - **Chain:** Select the correct chain (Ethereum, Polygon, etc.)
   - **Address:** Pool address from your config
   - **Topic0:** 
     - Uniswap V2/QuickSwap: `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`
     - Uniswap V3: `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
     - Balancer V2: `0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b`
   - **Webhook URL:** `https://your-domain.com/webhook`
   - **Include Logs:** ✅ Yes
4. Add the appropriate ABI (use files in `src/abis/`)
5. Save the stream

### Deploy

```bash
npm run build
npm run pm2:restart
```

## Notes

- The bot only alerts on **BUYS** (OCEAN leaving the pool)
- **SELLS** (OCEAN entering the pool) are ignored
- Each pool must be added to BOTH the code AND the webhook provider
- Minimum buy amount is controlled per-chat via `/setmin` command

# Changelog

All notable changes to this package are listed here. It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.1.0]

### Added

- Network files for mainnet, testnet and devnet, with a JSON Schema
- Node, archive and prover URLs, the apps' addresses, and the transfer, stake and Multicall contracts
- Sozu's hub, with fallbacks for its pool, relayer, substrate, stDUSK and vault
- A pointer to Dusk Domains' release manifest: version, URL and sha256
- DuskEVM on testnet: its chain, endpoints, predeploys, drivers and every L1 contract, from duskevm-genesis
- Bridge routes: BSC ↔ Dusk, Ethereum → Dusk and Dusk ↔ DuskEVM, with their chains, fees, times and whether each runs
- The retired testnet Sepolia migration contracts
- Dusk as the operator, with its terms and privacy notice
- Labels for every contract and account in the files, and the recipient blocklist
- `networkFor`, `labelFor`, `isBlocked`, `blockedReason`, `routes` and `bridgeLink`
- `/sozu`: Sozu's fee, stDUSK, minimum, unstake and gas rules, and its reads in one query
- `/rates`: native and Sozu reward-rate estimates
- `/format`: amounts, times, contract IDs, accounts and EVM addresses

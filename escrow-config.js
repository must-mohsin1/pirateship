globalThis.PIRATE_ESCROW_CONFIG = Object.freeze({
  // Source-verified Polygon PoS mainnet deployment. The immutable 300 POL minimum
  // and deadline are read from the contract and cannot be overridden here.
  contractAddress: "0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff",
  chainId: "0x89",
  chainName: "Polygon Mainnet",
  nativeSymbol: "POL",
  rpcUrls: [
    "https://polygon.drpc.org",
  ],
  explorerUrl: "https://polygonscan.com",

  // The integrated server exposes /api from this same origin.
  keyApiBase: "",
});

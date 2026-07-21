globalThis.PIRATE_ESCROW_CONFIG = Object.freeze({
  // Verified Polygon Amoy rehearsal deployment. Replace only after the audited mainnet launch.
  // The 0.01 test POL minimum is read from the deployed contract and cannot be overridden here.
  contractAddress: "0x6bF097816997C242F3447A470d1cc3d170cbcB98",
  chainId: "0x13882",
  chainName: "Polygon Amoy",
  nativeSymbol: "POL",
  rpcUrls: [
    "https://polygon-amoy.drpc.org",
  ],
  explorerUrl: "https://amoy.polygonscan.com",

  // The integrated server exposes /api from this same origin.
  keyApiBase: "",
});

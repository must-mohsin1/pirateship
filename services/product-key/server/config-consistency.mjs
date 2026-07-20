const CONTRACT_ADDRESS_PATTERN = /contractAddress\s*:\s*["'](0x[0-9a-fA-F]{40})["']/;

export function assertPublicContractMatches(publicConfigSource, verifierContractAddress) {
  const publicAddress = publicConfigSource.match(CONTRACT_ADDRESS_PATTERN)?.[1];
  if (!publicAddress) {
    throw new Error("escrow-config.js must contain one valid public contractAddress.");
  }
  if (publicAddress.toLowerCase() !== verifierContractAddress.toLowerCase()) {
    throw new Error(
      "Frontend and product-key service contract addresses differ. Refusing to start.",
    );
  }
  return publicAddress;
}

function parsePublicChainId(value) {
  try {
    const chainId = Number(BigInt(value));
    if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error();
    return chainId;
  } catch {
    throw new Error("escrow-config.js must contain one valid positive chainId.");
  }
}

export function assertPublicDeploymentMatches(
  publicConfig,
  verifierContractAddress,
  expectedChainId,
) {
  const publicAddress = publicConfig?.contractAddress;
  if (!/^0x[0-9a-fA-F]{40}$/.test(publicAddress ?? "")) {
    throw new Error("escrow-config.js must contain one valid public contractAddress.");
  }
  if (publicAddress.toLowerCase() !== verifierContractAddress.toLowerCase()) {
    throw new Error(
      "Frontend and product-key service contract addresses differ. Refusing to start.",
    );
  }

  const publicChainId = parsePublicChainId(publicConfig.chainId);
  if (publicChainId !== expectedChainId) {
    throw new Error(
      "Frontend and product-key service chain IDs differ. Refusing to start.",
    );
  }
  return { contractAddress: publicAddress, chainId: publicChainId };
}

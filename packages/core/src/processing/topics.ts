const TAXONOMY: Record<string, string[]> = {
  finance: ["stock", "market", "trading", "earnings", "ipo", "merger", "acquisition", "fed", "inflation", "gdp"],
  crypto: ["bitcoin", "ethereum", "blockchain", "defi", "nft", "token", "wallet", "on-chain"],
  geopolitics: ["sanctions", "election", "war", "treaty", "diplomacy", "nato", "summit"],
  regulation: ["sec", "fda", "regulation", "compliance", "antitrust", "lawsuit", "ruling"],
  technology: ["ai", "software", "chip", "semiconductor", "cyber", "hack", "breach", "startup"],
  energy: ["oil", "gas", "opec", "renewable", "solar", "nuclear"],
  health: ["vaccine", "clinical", "pharma", "hospital", "pandemic"],
};

export function classifyTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const [topic, keywords] of Object.entries(TAXONOMY)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(topic);
    }
  }

  return matched.length > 0 ? matched : ["general"];
}
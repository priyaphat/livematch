export interface InventorySlipItem {
  name: string;
  unit: string;
  stockQuantity: number;
  unitsPerPack: number;
  fullPacks: number | null;
  remainderUnits: number | null;
}

export function formatInventorySlipLine(item: InventorySlipItem): string {
  if (item.unitsPerPack <= 0) return `${item.name}  ${item.stockQuantity} ${item.unit}`;
  const fullPacks = item.fullPacks ?? Math.floor(item.stockQuantity / item.unitsPerPack);
  const remainderUnits = item.remainderUnits ?? item.stockQuantity % item.unitsPerPack;
  return `${item.name}\n  ${fullPacks} แพ็ค + เศษ ${remainderUnits} ${item.unit} · รวม ${item.stockQuantity} ${item.unit}`;
}

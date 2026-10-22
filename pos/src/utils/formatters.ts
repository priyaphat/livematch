export const formatCurrency = (
  amount: number,
  symbol = '฿',
  decimalPlaces = 2
): string => {
  const formattedNumber = Number(amount || 0).toLocaleString('th-TH', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
  return `${symbol}${formattedNumber}`;
};

export const formatThaiDateTime = (isoDateString: string): string => {
  try {
    const date = new Date(isoDateString);
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoDateString;
  }
};

export const formatThaiDateShort = (isoDateString: string): string => {
  try {
    const date = new Date(isoDateString);
    return date.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return isoDateString;
  }
};

export const formatThaiTime = (isoDateString: string): string => {
  try {
    const date = new Date(isoDateString);
    return date.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDateString;
  }
};

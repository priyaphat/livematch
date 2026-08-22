/**
 * Thai QR PromptPay EMVCo Payload Generator
 * Complies with Bank of Thailand & EMVCo Standard for PromptPay QR Payment
 */

// Calculate CRC16 CCITT (0xFFFF, Poly 0x1021)
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xff;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Helper to format EMVCo Tag-Length-Value (TLV)
function formatTLV(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

// Format Phone or TaxID to PromptPay standard
function formatPromptPayTarget(target: string): string {
  const cleaned = target.replace(/[^0-9]/g, '');

  // Phone number (10 digits starting with 0)
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    const internationalPhone = '0066' + cleaned.substring(1);
    return formatTLV('01', internationalPhone);
  }

  // Tax ID or National ID (13 digits)
  if (cleaned.length === 13) {
    return formatTLV('02', cleaned);
  }

  // e-Wallet ID (15 digits)
  if (cleaned.length === 15) {
    return formatTLV('03', cleaned);
  }

  // Fallback as phone or custom
  if (cleaned.length > 0) {
    if (cleaned.startsWith('0')) {
      return formatTLV('01', '0066' + cleaned.substring(1));
    }
    return formatTLV('02', cleaned);
  }

  return formatTLV('01', '0066812345678');
}

/**
 * Generates an official EMVCo Thai QR PromptPay payload string
 * @param promptPayId Mobile number (e.g. '0812345678') or Tax ID (e.g. '0105558912341')
 * @param amount Optional payment amount in THB
 */
export function generatePromptPayPayload(promptPayId: string, amount?: number): string {
  const targetTag = formatPromptPayTarget(promptPayId || '0812345678');
  
  // Tag 29: Merchant Account Information - PromptPay
  // AID for PromptPay: A000000677010111
  const aidTag = formatTLV('00', 'A000000677010111');
  const merchantAccountInfo = formatTLV('29', aidTag + targetTag);

  // Core EMVCo tags
  let payload = '';
  payload += formatTLV('00', '01'); // Payload Format Indicator
  payload += formatTLV('01', amount && amount > 0 ? '12' : '11'); // Point of Initiation: 12 (Dynamic), 11 (Static)
  payload += merchantAccountInfo;
  payload += formatTLV('53', '764'); // Currency: THB (764)

  if (amount !== undefined && amount > 0) {
    payload += formatTLV('54', amount.toFixed(2)); // Transaction Amount
  }

  payload += formatTLV('58', 'TH'); // Country Code
  payload += '6304'; // CRC placeholder (tag 63, length 04)

  const checksum = crc16(payload);
  return payload + checksum;
}

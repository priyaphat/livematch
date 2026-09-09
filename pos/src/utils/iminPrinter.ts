// Minimal iMin H5 printer client based on the official MIT-licensed iMin JS Printer SDK protocol.
type IminConnectionType = 'SPI' | 'USB' | 'Bluetooth';

interface IminMessage {
  type: number;
  data?: { value?: number; text?: string };
}

export interface IminPrinterStatus {
  available: boolean;
  ready: boolean;
  connectionType?: IminConnectionType;
  status: number;
  message: string;
}

const STATUS_MESSAGES: Record<number, string> = {
  0: 'พร้อมพิมพ์',
  3: 'ฝาครอบเครื่องพิมพ์เปิดอยู่',
  7: 'กระดาษหมด',
  8: 'กระดาษใกล้หมด',
  99: 'เครื่องพิมพ์แจ้งข้อผิดพลาด',
  [-1]: 'ไม่พบเครื่องพิมพ์',
  1: 'เครื่องพิมพ์ไม่ได้เปิดหรือไม่ได้เชื่อมต่อ',
};

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

class IminPrinterClient {
  private socket: WebSocket | null = null;
  private connectionPromise: Promise<boolean> | null = null;
  private statusResolver: ((message: IminMessage) => void) | null = null;

  async connect(): Promise<boolean> {
    if (this.socket?.readyState === WebSocket.OPEN) return true;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (connected: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(connected);
      };
      const timer = window.setTimeout(() => finish(false), 1800);
      try {
        const socket = new WebSocket('ws://127.0.0.1:8081/websocket');
        this.socket = socket;
        socket.onopen = () => finish(true);
        socket.onerror = () => finish(false);
        socket.onclose = () => {
          this.socket = null;
          finish(false);
        };
        socket.onmessage = (event) => {
          if (event.data === 'request') return;
          try {
            const message = JSON.parse(String(event.data)) as IminMessage;
            if (message.type === 2) this.statusResolver?.(message);
          } catch {
            // Ignore non-JSON heartbeat/vendor messages.
          }
        };
      } catch {
        finish(false);
      }
    }).finally(() => {
      this.connectionPromise = null;
    });
    return this.connectionPromise;
  }

  private send(type: number, text = '', value: string | number = -1) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('ยังเชื่อมต่อ iMin Web Print ไม่สำเร็จ');
    this.socket.send(JSON.stringify({ data: { text, value, labelData: {} }, type }));
  }

  private async waitForSendBuffer(timeoutMilliseconds = 2500) {
    const startedAt = Date.now();
    while (this.socket && this.socket.readyState === WebSocket.OPEN && Number(this.socket.bufferedAmount || 0) > 0) {
      if (Date.now() - startedAt >= timeoutMilliseconds) throw new Error('ส่งข้อมูลใบเสร็จไปยัง iMin ไม่ทันเวลา');
      await delay(25);
    }
  }

  private async readStatus(connectionType: IminConnectionType): Promise<number> {
    this.send(1, connectionType);
    await delay(80);
    return new Promise<number>((resolve) => {
      let settled = false;
      const finish = (value: number) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.statusResolver = null;
        resolve(value);
      };
      const timer = window.setTimeout(() => finish(-1), 1200);
      this.statusResolver = (message) => finish(Number(message.data?.value ?? -1));
      this.send(2, connectionType);
    });
  }

  async probe(): Promise<IminPrinterStatus> {
    if (!(await this.connect())) return { available: false, ready: false, status: -1, message: 'ไม่พบ iMin Web Print Service' };

    for (const connectionType of ['SPI', 'USB', 'Bluetooth'] as const) {
      const status = await this.readStatus(connectionType);
      if (status !== -1 && status !== 1) {
        return {
          available: true,
          ready: status === 0 || status === 8,
          connectionType,
          status,
          message: STATUS_MESSAGES[status] || `สถานะเครื่องพิมพ์ ${status}`,
        };
      }
    }
    return { available: true, ready: false, status: -1, message: STATUS_MESSAGES[-1] };
  }

  async printText(text: string, paperWidth: '58mm' | '80mm'): Promise<IminPrinterStatus> {
    const status = await this.probe();
    if (!status.ready || !status.connectionType) throw new Error(status.message);

    this.send(1, status.connectionType);
    this.send(25, '', paperWidth === '58mm' ? 1 : 0);
    this.send(6, '', 0);
    this.send(7, '', paperWidth === '58mm' ? 22 : 26);
    this.send(8, '', 1);
    this.send(9, '', 0);
    this.send(12, `${text.trimEnd()}\n`);
    this.send(4, '', 100);
    this.send(5);
    await delay(250);
    return status;
  }

  async printBitmaps(imageData: string[], paperWidth: '58mm' | '80mm'): Promise<IminPrinterStatus> {
    if (!imageData.length || imageData.some((image) => !image.startsWith('data:image/'))) {
      throw new Error('ข้อมูลภาพใบเสร็จไม่ถูกต้อง');
    }
    const status = await this.probe();
    if (!status.ready || !status.connectionType) throw new Error(status.message);

    this.send(1, status.connectionType);
    this.send(25, '', paperWidth === '58mm' ? 1 : 0);
    this.send(6, '', 1);
    for (const image of imageData) {
      this.send(26, image);
      await this.waitForSendBuffer();
      // Large receipts are intentionally sent as short vertical images. Giving
      // the local iMin service time between chunks prevents it dropping a job.
      await delay(140);
    }
    this.send(4, '', 100);
    this.send(5);
    await delay(350);
    return status;
  }

  async printBitmap(imageData: string, paperWidth: '58mm' | '80mm'): Promise<IminPrinterStatus> {
    return this.printBitmaps([imageData], paperWidth);
  }
}

const client = new IminPrinterClient();

export const probeIminPrinter = () => client.probe();
export const printIminText = (text: string, paperWidth: '58mm' | '80mm') => client.printText(text, paperWidth);
export const printIminBitmap = (imageData: string, paperWidth: '58mm' | '80mm') => client.printBitmap(imageData, paperWidth);
export const printIminBitmaps = (imageData: string[], paperWidth: '58mm' | '80mm') => client.printBitmaps(imageData, paperWidth);

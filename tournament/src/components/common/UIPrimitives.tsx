import React, { useState } from 'react';
import * as QRCode from 'qrcode';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export type SemanticTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live';

/**
 * Accessible status indicator: always pairs color + icon + explicit text label.
 * Never uses pill capsules on static metadata; renders clean crisp square-edged status indicators.
 */
export const StatusIndicator: React.FC<{
  tone: SemanticTone;
  label: string;
  compact?: boolean;
}> = ({ tone, label, compact }) => {
  const config: Record<
    SemanticTone,
    { classes: string; icon: React.ReactNode }
  > = {
    neutral: {
      classes:
        'bg-[#EFECE4] text-[#475569] border-[#D9D5C9] dark:bg-[#1B293D] dark:text-[#CBD5E1] dark:border-[#2C3E57]',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    success: {
      classes:
        'bg-[#ECFDF3] text-[#15803D] border-[#BBF7D0] dark:bg-[#0E2E1D] dark:text-[#4ADE80] dark:border-[#1B4D32]',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    warning: {
      classes:
        'bg-[#FEF9C3] text-[#92400E] border-[#FDE047] dark:bg-[#332409] dark:text-[#FACC15] dark:border-[#5C410D]',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    danger: {
      classes:
        'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA] dark:bg-[#361215] dark:text-[#F87171] dark:border-[#5E2025]',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    info: {
      classes:
        'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE] dark:bg-[#112442] dark:text-[#60A5FA] dark:border-[#1E3A6B]',
      icon: <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    live: {
      classes:
        'bg-[#156143] text-white border-[#104D35] dark:bg-[#229A6B] dark:text-[#07140E] dark:border-[#29B47D]',
      icon: <Play className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden="true" />,
    },
  };

  const c = config[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border rounded-md font-medium whitespace-nowrap shrink-0 ${
        compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } ${c.classes}`}
    >
      {c.icon}
      <span>{label}</span>
    </span>
  );
};

export const ConfirmModal: React.FC = () => {
  const { confirmState, closeConfirm } = useApp();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  if (!confirmState) return null;

  const handleConfirm = async () => {
    if (confirmState.requireReason && reason.trim().length < 3) {
      setErr('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรเพื่อบันทึกใน Audit Log');
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      await confirmState.onConfirm(reason.trim() || undefined);
      setReason('');
      closeConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] rounded-xl shadow-xl overflow-hidden">
        <div className="p-5 border-b border-[#E2DFD5] dark:border-[#25354C] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg shrink-0 ${
                confirmState.destructive
                  ? 'bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#361215] dark:text-[#F87171]'
                  : 'bg-[#FEF9C3] text-[#92400E] dark:bg-[#332409] dark:text-[#FACC15]'
              }`}
            >
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="confirm-modal-title"
                className="text-base font-semibold text-[#141D2B] dark:text-[#F3F5F8]"
              >
                {confirmState.title}
              </h3>
              <p className="mt-1 text-sm text-[#525C6B] dark:text-[#9AA8BC]">
                {confirmState.description}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setReason('');
              setErr('');
              closeConfirm();
            }}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#525C6B] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
            aria-label="ปิดหน้าต่างยืนยัน"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {confirmState.impactLines && confirmState.impactLines.length > 0 && (
            <div className="p-3 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] space-y-1.5">
              <div className="text-xs font-semibold text-[#142642] dark:text-[#F3F5F8]">
                ผลกระทบที่จะเกิดขึ้น:
              </div>
              <ul className="text-xs text-[#525C6B] dark:text-[#9AA8BC] space-y-1 list-disc list-inside">
                {confirmState.impactLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {confirmState.requireReason && (
            <div>
              <label className="block text-sm font-medium text-[#141D2B] dark:text-[#F3F5F8] mb-1.5">
                เหตุผลในการดำเนินการ (บันทึกลง Audit Log) <span className="text-[#B91C1C]">*</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  confirmState.reasonPlaceholder || 'ระบุเหตุผล เช่น กรรมการขอแก้ไขคะแนนตามใบคำร้อง'
                }
                className="w-full rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#0B121C] px-3 py-2 text-sm text-[#141D2B] dark:text-[#F3F5F8]"
              />
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 text-xs text-[#B91C1C] dark:text-[#F87171]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#F7F6F2] dark:bg-[#0B121C] border-t border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-end gap-3">
          <button
            onClick={() => {
              setReason('');
              setErr('');
              closeConfirm();
            }}
            disabled={submitting}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-sm font-medium text-[#141D2B] dark:text-[#F3F5F8] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            {confirmState.cancelLabel || 'ยกเลิก'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`min-h-[44px] px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              confirmState.destructive
                ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                : 'bg-[#156143] hover:bg-[#104D35]'
            }`}
          >
            {submitting ? 'กำลังดำเนินการ...' : confirmState.confirmLabel || 'ยืนยันดำเนินการ'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 md:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const toneMap = {
          success:
            'bg-[#ECFDF3] border-[#86EFAC] text-[#14532D] dark:bg-[#0E2E1D] dark:border-[#1B4D32] dark:text-[#86EFAC]',
          error:
            'bg-[#FEF2F2] border-[#FCA5A5] text-[#7F1D1D] dark:bg-[#361215] dark:border-[#7F1D1D] dark:text-[#FCA5A5]',
          warning:
            'bg-[#FEF9C3] border-[#FDE047] text-[#713F12] dark:bg-[#332409] dark:border-[#854D0E] dark:text-[#FDE047]',
          info: 'bg-white border-[#E2DFD5] text-[#141D2B] dark:bg-[#131E2E] dark:border-[#25354C] dark:text-[#F3F5F8]',
        }[t.type];

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-md text-sm font-medium ${toneMap}`}
          >
            <span>{t.text}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="p-1 rounded hover:bg-black/10"
              aria-label="ปิดการแจ้งเตือน"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

/** Standards-compliant QR code used by registration, status and Director login flows. */
export const QRCodeMatrix: React.FC<{ value: string; size?: number }> = ({
  value,
  size = 132,
}) => {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const cells = qr.modules.size;
  const quietZone = 4;
  const viewSize = cells + quietZone * 2;
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.modules.get(r, c)) {
        rects.push(<rect key={`${r}-${c}`} x={c + quietZone} y={r + quietZone} width={1} height={1} fill="#142642" />);
      }
    }
  }

  return (
    <div className="inline-flex p-3 bg-white rounded-xl border border-[#E2DFD5]">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR Code สำหรับ ${value}`}
      >
        <rect width={viewSize} height={viewSize} fill="#FFFFFF" />
        {rects}
      </svg>
    </div>
  );
};

export const EmptyStateCard: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="p-8 text-center rounded-xl border border-dashed border-[#D5D1C5] dark:border-[#2C3E57] bg-white/60 dark:bg-[#131E2E]/60">
    <div className="mx-auto w-11 h-11 rounded-full bg-[#EFECE4] dark:bg-[#1B293D] flex items-center justify-center text-[#525C6B] dark:text-[#9AA8BC] mb-3">
      <Info className="w-5 h-5" />
    </div>
    <h4 className="text-base font-semibold text-[#141D2B] dark:text-[#F3F5F8]">{title}</h4>
    <p className="mt-1 text-sm text-[#525C6B] dark:text-[#9AA8BC] max-w-md mx-auto">{description}</p>
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-4 min-h-[44px] px-4 py-2 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-sm font-medium"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const LoadingSkeletonRows: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-2.5 animate-pulse" aria-busy="true" aria-label="กำลังโหลดข้อมูล">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-12 rounded-lg bg-[#EFECE4] dark:bg-[#1B293D] border border-[#E2DFD5] dark:border-[#25354C]"
      />
    ))}
  </div>
);

export const ErrorStateBanner: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="p-4 rounded-xl border border-[#FECACA] dark:border-[#5E2025] bg-[#FEF2F2] dark:bg-[#361215] flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-2.5 text-sm text-[#B91C1C] dark:text-[#F87171]">
      <AlertCircle className="w-5 h-5 shrink-0" />
      <span>{message}</span>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white dark:bg-[#131E2E] border border-[#FECACA] dark:border-[#5E2025] text-xs font-semibold text-[#B91C1C] dark:text-[#F87171] inline-flex items-center gap-1.5"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>ลองใหม่</span>
      </button>
    )}
  </div>
);

export const EmergencyPauseBanner: React.FC<{
  reason?: string;
  onResume?: () => void;
  canResume?: boolean;
}> = ({ reason, onResume, canResume }) => (
  <div className="px-4 py-3 rounded-xl bg-[#FEF9C3] dark:bg-[#332409] border border-[#FDE047] dark:border-[#5C410D] flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-2.5 text-sm font-medium text-[#713F12] dark:text-[#FDE047]">
      <PauseCircle className="w-5 h-5 shrink-0" />
      <span>
        ประกาศพักการแข่งขันชั่วคราว: {reason || 'หยุดพักฉุกเฉิน / สภาพอากาศหรือหลังคาสนามรั่วซึม'}
      </span>
    </div>
    {canResume && onResume && (
      <button
        onClick={onResume}
        className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-[#142642] text-white text-xs font-semibold hover:bg-[#1D355C]"
      >
        กลับมาแข่งขันต่อ
      </button>
    )}
  </div>
);

export const LockIconBadge: React.FC<{ locked: boolean }> = ({ locked }) =>
  locked ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[#142642] dark:text-[#CBD5E1]">
      <Lock className="w-3.5 h-3.5" />
      <span>ล็อกผลแล้ว</span>
    </span>
  ) : null;

export const PaginationBar: React.FC<{
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange?: (nextSize: number) => void;
  pageSizeOptions?: number[];
}> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}) => {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(totalItems, safePage * pageSize);

  const pageNumbers: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (safePage > 3) pageNumbers.push('ellipsis');
    const winStart = Math.max(2, safePage - 1);
    const winEnd = Math.min(totalPages - 1, safePage + 1);
    for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
    if (safePage < totalPages - 2) pageNumbers.push('ellipsis');
    pageNumbers.push(totalPages);
  }

  return (
    <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-3 text-[#525C6B] dark:text-[#9AA8BC]">
        <span className="tabular-nums">
          แสดง <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{startIdx}–{endIdx}</strong> จากทั้งหมด{' '}
          <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{totalItems}</strong> รายการ
        </span>
        {onPageSizeChange && (
          <label className="inline-flex items-center gap-1.5">
            <span>ต่อหน้า:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              aria-label="จำนวนรายการต่อหน้า"
              className="min-h-[34px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-xs text-[#141D2B] dark:text-[#F3F5F8]"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="หน้าก่อนหน้า"
          className="min-h-[36px] min-w-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] inline-flex items-center justify-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">ก่อนหน้า</span>
        </button>

        {pageNumbers.map((item, idx) =>
          item === 'ellipsis' ? (
            <span key={`e-${idx}`} className="px-1.5 text-[#525C6B] dark:text-[#9AA8BC]">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === safePage ? 'page' : undefined}
              className={`min-h-[36px] min-w-[36px] px-2.5 rounded-lg font-mono tabular-nums font-semibold transition-colors ${
                item === safePage
                  ? 'bg-[#156143] text-white'
                  : 'border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-[#141D2B] dark:text-[#F3F5F8]'
              }`}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="หน้าถัดไป"
          className="min-h-[36px] min-w-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] inline-flex items-center justify-center gap-1 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="hidden sm:inline">ถัดไป</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const TEAM_CREST_PALETTES = [
  'from-[#156143] to-[#0B3B28] text-[#DCFCE7] border-[#229A6B]/50',
  'from-[#142642] to-[#0A1424] text-[#E0F2FE] border-[#3B82F6]/40',
  'from-[#7C2D12] to-[#431407] text-[#FFEDD5] border-[#EA580C]/45',
  'from-[#0F4C5C] to-[#062730] text-[#CFFAFE] border-[#06B6D4]/45',
  'from-[#3730A3] to-[#1E1B4B] text-[#E0E7FF] border-[#6366F1]/45',
  'from-[#854D0E] to-[#422006] text-[#FEF9C3] border-[#EAB308]/50',
];

function isPlaceholderTeamName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const upper = trimmed.toUpperCase();
  if (upper === 'BYE' || upper === 'TBD') return true;
  if (
    trimmed.startsWith('รอผล') ||
    trimmed.startsWith('ผู้ชนะ') ||
    trimmed.startsWith('ว่าง')
  ) {
    return true;
  }
  return false;
}

function getTeamInitials(name: string): string {
  const cleaned = name
    .replace(/^(ทีม|คู่)\s*/u, '')
    .replace(/[^\p{L}\p{N}\s/&-]/gu, '')
    .trim();
  if (!cleaned) return 'TM';
  const parts = cleaned.split(/[\s/&-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = Array.from(parts[0])[0] || '';
    const second = Array.from(parts[1])[0] || '';
    return `${first}${second}`.toUpperCase();
  }
  const chars = Array.from(parts[0] || cleaned).filter((ch) => !/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u.test(ch));
  if (chars.length >= 2) return `${chars[0]}${chars[1]}`.toUpperCase();
  return Array.from(cleaned).slice(0, 2).join('').toUpperCase();
}

function hashTeamName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function buildTeamLogoMap(
  teams: Array<{ id?: string; teamName?: string; teamLogoUrl?: string }>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const t of teams) {
    if (!t.teamLogoUrl) continue;
    if (t.id) map[t.id] = t.teamLogoUrl;
    if (t.teamName) map[t.teamName] = t.teamLogoUrl;
  }
  return map;
}

export const TeamLogoBadge: React.FC<{
  teamName: string;
  logoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  highlight?: boolean;
  className?: string;
}> = ({ teamName, logoUrl, size = 'sm', highlight = false, className = '' }) => {
  const [imgFailed, setImgFailed] = useState(false);

  if (isPlaceholderTeamName(teamName)) {
    return null;
  }

  const sizeMap: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
    xs: 'w-5 h-5 rounded-md text-[9px]',
    sm: 'w-7 h-7 rounded-lg text-[10px]',
    md: 'w-9 h-9 sm:w-10 sm:h-10 rounded-xl text-xs',
    lg: 'w-12 h-12 sm:w-14 sm:h-14 rounded-2xl text-base',
    xl: 'w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 rounded-2xl sm:rounded-3xl text-xl sm:text-2xl lg:text-3xl',
  };

  const palette =
    TEAM_CREST_PALETTES[hashTeamName(teamName) % TEAM_CREST_PALETTES.length];
  const initials = getTeamInitials(teamName);
  const ringClass = highlight
    ? 'ring-2 ring-[#EAB308] ring-offset-1 ring-offset-transparent'
    : '';

  if (logoUrl && !imgFailed) {
    return (
      <div
        className={`${sizeMap[size]} ${ringClass} overflow-hidden shrink-0 border border-black/10 dark:border-white/15 bg-white shadow-xs flex items-center justify-center ${className}`}
        title={teamName}
      >
        <img
          src={logoUrl}
          alt={`โลโก้ ${teamName}`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeMap[size]} ${ringClass} bg-gradient-to-br ${palette} border shrink-0 shadow-xs flex items-center justify-center font-extrabold tracking-tight select-none relative overflow-hidden ${className}`}
      title={teamName}
      aria-hidden="true"
    >
      <span className="relative z-10 leading-none">{initials}</span>
    </div>
  );
};


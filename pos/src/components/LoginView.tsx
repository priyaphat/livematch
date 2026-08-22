import React, { FormEvent, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Store } from 'lucide-react';
import { InstallPwaButton } from './InstallPwaButton';
import { AuthApiError, LoginCredentials } from '../api/auth';

interface LoginViewProps {
  onLogin: (credentials: LoginCredentials) => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await onLogin({ email: email.trim(), password, remember });
    } catch (requestError) {
      if (requestError instanceof AuthApiError) {
        const messages: Record<string, string> = {
          invalid_login: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
          pos_not_enabled: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ',
          'email not verified': 'กรุณายืนยันอีเมลใน LiveMatch ก่อนเข้าสู่ระบบ POS',
          'too many requests': 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
        };
        setError(messages[requestError.code] || requestError.message);
      } else {
        setError('เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบว่า LiveMatch API กำลังทำงาน');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-y-auto bg-slate-950 px-4 py-6 text-slate-100 sm:grid sm:place-items-center sm:px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-600/25 blur-3xl" />
        <div className="absolute -bottom-40 -right-28 h-[28rem] w-[28rem] rounded-full bg-amber-400/15 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/90 shadow-2xl shadow-black/40 backdrop-blur-xl lg:grid-cols-[1.08fr_.92fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-amber-500 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-20 top-20 h-64 w-64 rounded-full border-[42px] border-white/10" />
          <div className="absolute -bottom-16 -left-14 h-56 w-56 rotate-12 rounded-[3rem] bg-slate-950/15" />

          <div className="relative flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-red-600 shadow-xl shadow-red-950/20">
              <Store className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xl font-black tracking-tight">LiveMatch POS</p>
              <p className="text-xs font-semibold text-white/75">ระบบจัดการหน้าร้านสำหรับสนามแบด</p>
            </div>
          </div>

          <div className="relative max-w-md">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur">
              <ShieldCheck className="h-4 w-4" />
              พื้นที่สำหรับผู้ดูแล
            </p>
            <h1 className="text-5xl font-black leading-tight tracking-tight">ขายไว<br />จัดการง่าย<br />ครบในที่เดียว</h1>
            <p className="mt-5 text-sm font-medium leading-7 text-white/80">จัดการการขาย สินค้า สต็อก บิล และรายงานประจำวันจากหน้าจอเดียว</p>
          </div>

          <p className="relative text-xs font-semibold text-white/65">LiveMatch POS · Secure admin access</p>
        </section>

        <section className="flex min-h-[620px] flex-col bg-white p-6 text-slate-900 dark:bg-slate-900 dark:text-white sm:p-10 lg:p-12">
          <div className="flex items-center justify-between lg:justify-end">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-amber-500 text-white shadow-lg shadow-red-600/20">
                <Store className="h-5 w-5" />
              </span>
              <div>
                <p className="font-black">LiveMatch POS</p>
                <p className="text-[10px] font-semibold text-slate-500">Admin access</p>
              </div>
            </div>
            <InstallPwaButton />
          </div>

          <div className="my-auto py-10">
            <p className="text-sm font-bold text-red-600 dark:text-amber-400">ยินดีต้อนรับกลับ</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">เข้าสู่ระบบ POS</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">กรอกข้อมูลผู้ดูแลเพื่อเริ่มจัดการหน้าร้านของคุณ</p>

            <form className="mt-8 space-y-5" onSubmit={submit}>
              <label className="block">
                <span className="mb-2 block text-sm font-bold">อีเมล / Admin No. / Staff Number</span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="text"
                    autoComplete="username"
                    required
                    placeholder="admin@example.com หรือ 1001-01"
                    className="h-13 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-sm font-semibold outline-none transition focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-500/10 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-amber-400 dark:focus:bg-slate-800 dark:focus:ring-amber-400/10"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold">รหัสผ่าน / PIN</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="กรอกรหัสผ่าน หรือ PIN 4-6 หลัก"
                    className="h-13 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-12 text-sm font-semibold outline-none transition focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-500/10 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-amber-400 dark:focus:bg-slate-800 dark:focus:ring-amber-400/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>

              <div className="flex items-center gap-3 text-xs font-semibold">
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-red-600"
                  />
                  จดจำการเข้าสู่ระบบ
                </label>
              </div>

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold leading-5 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-red-600/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-red-600/30 active:translate-y-0 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0"
              >
                {isSubmitting ? (
                  <>
                    กำลังเข้าสู่ระบบ
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  </>
                ) : (
                  <>
                    เข้าสู่ระบบ
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              เจ้าของใช้อีเมลหรือ Admin No. + รหัสผ่าน ส่วนพนักงานใช้อีเมลหรือ Staff Number + PIN
            </div>
          </div>

          <p className="text-center text-[11px] font-medium text-slate-400">© 2026 LiveMatch. ระบบจัดการสนามแบดมินตัน</p>
        </section>
      </div>
    </main>
  );
};

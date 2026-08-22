import React, { useState, useEffect } from 'react';
import { PosProvider, usePos } from './context/PosContext';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { PosView } from './components/PosView';
import { DashboardView } from './components/DashboardView';
import { BillsView } from './components/BillsView';
import { ProductsView } from './components/ProductsView';
import { StockView } from './components/StockView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { CustomerDisplayView } from './components/CustomerDisplayView';
import { PaymentModal } from './components/PaymentModal';
import { ReceiptModal } from './components/ReceiptModal';
import { LoginView } from './components/LoginView';
import {
  AdminUser,
  getCurrentAdmin,
  LoginCredentials,
  loginAdmin,
  logoutAdmin,
} from './api/auth';
import { POSPermissions } from './api/posAccess';

const ALL_POS_PERMISSIONS: POSPermissions = {
  sales: true,
  bills: true,
  products: true,
  stock: true,
  reports: true,
  settings: true,
};

const PosAppContent: React.FC = () => {
  const { activeTab, setActiveTab } = usePos();
  const [isStandaloneCustomerDisplay, setIsStandaloneCustomerDisplay] = useState(false);
  const [authUser, setAuthUser] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<POSPermissions>(ALL_POS_PERMISSIONS);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    // Check if opened as standalone secondary customer display window
    const searchParams = new URLSearchParams(window.location.search);
    const displayParam = searchParams.get('display');
    const viewParam = searchParams.get('view');
    const modeParam = searchParams.get('mode');
    if (
      displayParam === 'customer' ||
      displayParam === 'front' ||
      viewParam === 'customer-display' ||
      viewParam === 'customer' ||
      modeParam === 'customer'
    ) {
      setIsStandaloneCustomerDisplay(true);
    }
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const allowedTabs = [
      permissions.sales && 'pos',
      permissions.bills && 'bills',
      permissions.products && 'products',
      permissions.stock && 'stock',
      permissions.reports && 'dashboard',
      permissions.settings && 'settings',
    ].filter(Boolean) as Array<'pos' | 'bills' | 'products' | 'stock' | 'dashboard' | 'settings'>;
    const permissionByTab = {
      pos: permissions.sales,
      dashboard: permissions.reports,
      bills: permissions.bills,
      products: permissions.products,
      stock: permissions.stock,
      reports: permissions.reports,
      settings: permissions.settings,
      'customer-display': permissions.sales,
    };
    if (!permissionByTab[activeTab] && allowedTabs[0]) setActiveTab(allowedTabs[0]);
  }, [activeTab, authUser, permissions, setActiveTab]);

  useEffect(() => {
    let active = true;
    getCurrentAdmin()
      .then((payload) => {
        if (active) {
          setAuthUser(payload.user);
          setPermissions(payload.permissions || ALL_POS_PERMISSIONS);
          window.dispatchEvent(new CustomEvent('livematch:pos-authenticated', { detail: { permissions: payload.permissions || ALL_POS_PERMISSIONS } }));
        }
      })
      .catch(() => {
        if (active) setAuthUser(null);
      })
      .finally(() => {
        if (active) setIsCheckingAuth(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (credentials: LoginCredentials) => {
    const payload = await loginAdmin(credentials);
    setAuthUser(payload.user);
    setPermissions(payload.permissions || ALL_POS_PERMISSIONS);
    window.dispatchEvent(new CustomEvent('livematch:pos-authenticated', { detail: { permissions: payload.permissions || ALL_POS_PERMISSIONS } }));
  };

  const handleLogout = async () => {
    try {
      await logoutAdmin();
    } finally {
      setAuthUser(null);
	  window.dispatchEvent(new Event('livematch:pos-logged-out'));
    }
  };

  useEffect(() => {
	const handleUnauthorized = () => { setAuthUser(null); window.dispatchEvent(new Event('livematch:pos-logged-out')); };
    window.addEventListener('livematch:pos-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('livematch:pos-unauthorized', handleUnauthorized);
  }, []);

  // If in dedicated standalone customer display mode (e.g. secondary monitor / window)
  if (isStandaloneCustomerDisplay) {
    return (
      <div className="h-screen w-full bg-slate-50 text-slate-900 flex flex-col font-sans overflow-hidden">
        <CustomerDisplayView isStandaloneWindow={true} />
      </div>
    );
  }

  if (isCheckingAuth) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-100">
        <div className="flex items-center gap-3 text-sm font-bold">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-amber-400" />
          กำลังตรวจสอบการเข้าสู่ระบบ
        </div>
      </main>
    );
  }

  if (!authUser) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans selection:bg-red-600 selection:text-white overflow-hidden transition-colors">
      {/* Top Navigation Bar */}
      <Navbar
        onLogout={handleLogout}
        adminName={authUser.name}
        adminNumber={authUser.posAdminNumber}
      />

      {/* Main View Area */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeTab === 'pos' && permissions.sales && <PosView />}
        {activeTab === 'dashboard' && permissions.reports && <DashboardView />}
        {activeTab === 'bills' && permissions.bills && <BillsView />}
        {activeTab === 'products' && permissions.products && <ProductsView />}
        {activeTab === 'stock' && permissions.stock && <StockView />}
        {activeTab === 'reports' && permissions.reports && <ReportsView />}
        {activeTab === 'settings' && permissions.settings && <SettingsView currentUser={authUser} />}
        {activeTab === 'customer-display' && permissions.sales && <CustomerDisplayView />}
      </main>

      {/* Bottom Floating Navigation Dock */}
      <BottomNav permissions={permissions} />

      {/* Global Modals */}
      <ReceiptModal />
    </div>
  );
};

export default function App() {
  return (
    <PosProvider>
      <PosAppContent />
    </PosProvider>
  );
}

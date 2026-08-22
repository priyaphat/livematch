import React from 'react';
import { usePos } from '../context/PosContext';
import {
  LayoutDashboard,
  ShoppingBag,
  Receipt,
  Package,
  ArrowLeftRight,
  BarChart3,
  Settings,
} from 'lucide-react';
import { POSPermissions } from '../api/posAccess';

interface BottomNavProps {
  permissions: POSPermissions;
}

export const BottomNav: React.FC<BottomNavProps> = ({ permissions }) => {
  const { activeTab, setActiveTab, heldOrders, products } = usePos();

  // Calculate low stock alert count
  const lowStockCount = products.filter((p) => p.stock <= p.minStockAlert).length;

  const navItems = [
    {
      id: 'dashboard' as const,
      label: 'แดชบอร์ด',
      icon: LayoutDashboard,
      permission: 'reports' as const,
    },
    {
      id: 'pos' as const,
      label: 'หน้าการขาย',
      icon: ShoppingBag,
      permission: 'sales' as const,
    },
    {
      id: 'bills' as const,
      label: 'บิล & ประวัติ',
      icon: Receipt,
      permission: 'bills' as const,
      badge: heldOrders.length > 0 ? heldOrders.length : undefined,
      badgeColor: 'bg-amber-500 text-slate-950',
    },
    {
      id: 'products' as const,
      label: 'จัดการสินค้า',
      icon: Package,
      permission: 'products' as const,
    },
    {
      id: 'stock' as const,
      label: 'จัดการสต็อก',
      icon: ArrowLeftRight,
      permission: 'stock' as const,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      id: 'reports' as const,
      label: 'รายงาน',
      icon: BarChart3,
      permission: 'reports' as const,
    },
    {
      id: 'settings' as const,
      label: 'ตั้งค่า',
      icon: Settings,
      permission: 'settings' as const,
    },
  ];

  return (
    <div className="fixed bottom-3 left-3 sm:left-6 z-40 flex justify-start pointer-events-none max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-3rem)]">
      <nav
        id="bottom-dock-navigation"
        className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xl dark:shadow-2xl max-w-full overflow-x-auto"
      >
        {navItems.filter((item) => permissions[item.permission]).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center justify-center min-w-[58px] sm:min-w-[68px] py-1.5 px-2 rounded-xl transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-red-600 via-red-500 to-red-600 text-white font-bold shadow-lg shadow-red-600/30 scale-105'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {/* Badge */}
              {item.badge !== undefined && (
                <span
                  className={`absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold border-2 border-white dark:border-slate-900 ${
                    item.badgeColor || 'bg-yellow-400 text-slate-950'
                  } shadow-md`}
                >
                  {item.badge}
                </span>
              )}

              <Icon
                className={`w-5 h-5 ${
                  isActive ? 'text-yellow-300 stroke-[2.5]' : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              <span
                className={`text-[11px] mt-0.5 tracking-tight whitespace-nowrap font-bold ${
                  isActive ? 'text-white' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

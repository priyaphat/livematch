import React, { useEffect, useState } from 'react';
import { usePos } from '../context/PosContext';
import {
  LayoutDashboard,
  ShoppingBag,
  Receipt,
  Package,
  ArrowLeftRight,
  BarChart3,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { POSPermissions } from '../api/posAccess';

interface BottomNavProps {
  permissions: POSPermissions;
}

export const BottomNav: React.FC<BottomNavProps> = ({ permissions }) => {
  const { activeTab, setActiveTab, heldOrders, products } = usePos();
  const [dockSide, setDockSide] = useState<'left' | 'right'>(() =>
    window.localStorage.getItem('livematch_pos_dock_side') === 'right' ? 'right' : 'left'
  );

  useEffect(() => {
    window.localStorage.setItem('livematch_pos_dock_side', dockSide);
  }, [dockSide]);

  // Calculate low stock alert count
  const lowStockCount = products.filter((p) => p.trackStock && p.stock <= p.minStockAlert).length;

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
    <div className="fixed bottom-3 left-3 right-3 sm:left-6 sm:right-6 z-40 h-[66px] pointer-events-none">
      <nav
        id="bottom-dock-navigation"
        data-dock-side={dockSide}
        style={{ left: dockSide === 'left' ? '0%' : '100%', transform: dockSide === 'left' ? 'translateX(0)' : 'translateX(-100%)' }}
        className="pointer-events-auto absolute bottom-0 flex w-full max-w-full items-stretch gap-1 rounded-2xl border border-slate-200 bg-white/95 px-1.5 py-1.5 shadow-xl backdrop-blur-xl transition-[left,transform] duration-300 ease-in-out dark:border-slate-700/80 dark:bg-slate-900/90 dark:shadow-2xl sm:w-max sm:gap-1.5 sm:px-2 sm:py-2"
      >
        {dockSide === 'right' && (
          <button
            type="button"
            aria-label="เลื่อนเมนูไปด้านซ้าย"
            title="เลื่อนเมนูไปด้านซ้าย"
            onClick={() => setDockSide('left')}
            className="shrink-0 self-stretch rounded-xl border border-slate-200 bg-slate-50 px-1.5 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-yellow-500/50 dark:hover:text-yellow-300"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-visible sm:gap-1.5">
          {navItems.filter((item) => permissions[item.permission]).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                id={`nav-tab-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`relative flex w-[68px] min-w-[68px] max-w-[68px] flex-none flex-col items-center justify-center rounded-xl px-1 py-1.5 transition-all ${
                  isActive
                    ? 'scale-105 bg-gradient-to-r from-red-600 via-red-500 to-red-600 font-bold text-white shadow-lg shadow-red-600/30'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white'
                }`}
              >
                {/* Badge */}
                {item.badge !== undefined && (
                  <span
                    className={`absolute -right-1 -top-1 rounded-full border-2 border-white px-1.5 py-0.2 text-[10px] font-bold shadow-md dark:border-slate-900 ${
                      item.badgeColor || 'bg-yellow-400 text-slate-950'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}

                <Icon
                  className={`h-5 w-5 ${
                    isActive ? 'text-yellow-300 stroke-[2.5]' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                <span
                  className={`mt-0.5 whitespace-nowrap text-[11px] font-bold tracking-tight ${
                    isActive ? 'text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {dockSide === 'left' && (
          <button
            type="button"
            aria-label="เลื่อนเมนูไปด้านขวา"
            title="เลื่อนเมนูไปด้านขวา"
            onClick={() => setDockSide('right')}
            className="shrink-0 self-stretch rounded-xl border border-slate-200 bg-slate-50 px-1.5 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-yellow-500/50 dark:hover:text-yellow-300"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        )}
      </nav>
    </div>
  );
};

import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { orderAPI, menuAPI, notificationAPI, settingsAPI } from "../services/api";
import {
  IconPOS,
  IconDashboard,
  IconKitchen,
  IconReports,
  IconMenu,
  IconCategories,
  IconTables,
  IconCustomers,
  IconCoupons,
  IconInventory,
  IconRecipes,
  IconStaff,
  IconLoyalty,
  IconCommunications,
  IconPurchaseOrders,
  IconWaste,
  IconSettings,
  IconBell,
  IconSearch,
  IconLogout,
  IconGear,
  IconMenuBurger,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconCart,
  IconDelivery,
} from "./icons";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { name: "POS", href: "/", icon: IconPOS, roles: ["admin", "cashier"] },
      { name: "Dashboard", href: "/dashboard", icon: IconDashboard, roles: ["admin"] },
      { name: "Kitchen", href: "/kitchen", icon: IconKitchen, roles: ["admin", "kitchen"] },
      { name: "Delivery", href: "/delivery", icon: IconDelivery, roles: ["delivery"] },
      { name: "Tracking", href: "/tracking", icon: IconDelivery, roles: ["admin", "cashier"] },
      { name: "Reports", href: "/reports", icon: IconReports, roles: ["admin"] },
    ],
  },
  {
    label: "Menu & Tables",
    items: [
      { name: "Menu", href: "/menu", icon: IconMenu, roles: ["admin"] },
      { name: "Categories", href: "/categories", icon: IconCategories, roles: ["admin"] },
      { name: "Tables", href: "/tables", icon: IconTables, roles: ["admin"] },
    ],
  },
  {
    label: "Customers & Sales",
    items: [
      { name: "Customers", href: "/customers", icon: IconCustomers, roles: ["admin", "cashier"] },
      { name: "Coupons", href: "/coupons", icon: IconCoupons, roles: ["admin"] },
      { name: "Loyalty", href: "/loyalty", icon: IconLoyalty, roles: ["admin"] },
      { name: "Communications", href: "/communications", icon: IconCommunications, roles: ["admin"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { name: "Inventory", href: "/inventory", icon: IconInventory, roles: ["admin"] },
      { name: "Recipes", href: "/recipes", icon: IconRecipes, roles: ["admin"] },
      { name: "Purchase Orders", href: "/purchase-orders", icon: IconPurchaseOrders, roles: ["admin"] },
      { name: "Waste", href: "/waste", icon: IconWaste, roles: ["admin"] },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Staff", href: "/staff", icon: IconStaff, roles: ["admin"] },
      { name: "Settings", href: "/settings", icon: IconSettings, roles: ["admin"] },
    ],
  },
];

export default function MainLayout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState("");
  const notifRef = useRef(null);
  const notifLoadedRef = useRef(false);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const searchQueryRef = useRef("");

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  useEffect(() => {
    let cancelled = false;
    settingsAPI
      .getPublic()
      .then((res) => {
        if (res.data.success && !cancelled) setRestaurantName(res.data.settings?.restaurant_name || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsClick = () => {
    setUserMenuOpen(false);
    navigate("/settings");
  };

  const handleUserMenuToggle = (e) => {
    e.stopPropagation();
    setUserMenuOpen(!userMenuOpen);
  };

  const isMobileViewport = () => window.matchMedia("(max-width: 1024px)").matches;

  const toggleSidebar = () => {
    if (isMobileViewport()) {
      setSidebarOpen((open) => !open);
    } else {
      setSidebarCollapsed((collapsed) => !collapsed);
    }
  };

  const handleOutsideClick = () => {
    setUserMenuOpen(false);
  };

  useEffect(() => {
    if (userMenuOpen) {
      document.addEventListener("click", handleOutsideClick);
      return () => document.removeEventListener("click", handleOutsideClick);
    }
  }, [userMenuOpen]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchOpen(false);
      return;
    }

    setSearchLoading(true);
    setSearchOpen(true);

    const timer = setTimeout(async () => {
      try {
        const [ordersRes, menuRes] = await Promise.all([
          orderAPI.getAll({ search: q, limit: 5 }),
          menuAPI.getAll({ search: q, limit: 5, availableOnly: "false" }),
        ]);
        if (searchQueryRef.current.trim() !== q) return;
        setSearchResults([
          ...(ordersRes.data.orders || []).map((o) => ({ type: "order", ...o })),
          ...(menuRes.data.menuItems || []).map((m) => ({ type: "menu", ...m })),
        ]);
      } catch {
        if (searchQueryRef.current.trim() === q) setSearchResults([]);
      } finally {
        if (searchQueryRef.current.trim() === q) setSearchLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const handleSearchResultClick = (result) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    if (result.type === "order") {
      navigate("/", { state: { posTab: "orders", orderId: result._id } });
    } else {
      navigate("/menu", { state: { menuItemId: result._id } });
    }
  };

  const loadNotifications = useCallback(async () => {
    try {
      const res = await notificationAPI.getMine();
      if (res.data.success) {
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unreadCount || 0);
      }
    } catch (err) {
      // silent: keep whatever we already have
    } finally {
      notifLoadedRef.current = true;
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    const onFocus = () => loadNotifications();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadNotifications]);

  const toggleNotifications = (e) => {
    e.stopPropagation();
    setNotifOpen((open) => !open);
  };

  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onEsc);
    };
  }, [notifOpen]);

  const timeAgo = (ts) => {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const notifIcon = (type) => {
    switch (type) {
      case "order":
        return <IconDelivery size={17} />;
      case "inventory":
        return <IconInventory size={17} />;
      case "customer":
        return <IconCustomers size={17} />;
      case "staff":
        return <IconStaff size={17} />;
      case "payment":
        return <IconCart size={17} />;
      default:
        return <IconBell size={17} />;
    }
  };

  const handleNotificationClick = async (n) => {
    setNotifOpen(false);
    if (!n.read) {
      setUnreadCount((count) => Math.max(0, count - 1));
      setNotifications((prev) =>
        prev.map((x) => (x._id === n._id ? { ...x, read: true, readAt: new Date().toISOString() } : x))
      );
      try {
        await notificationAPI.markAsRead(n._id);
      } catch (err) {
        // ignore
      }
    }
    if (n.type === "order") {
      navigate("/", { state: { posTab: "orders", orderId: n.entityId } });
    } else {
      navigate(n.link || "/");
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    try {
      await notificationAPI.markAllAsRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((x) => ({ ...x, read: true, readAt: new Date().toISOString() })));
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    dropdownRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const getInitials = (name) => {
    return name?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "U";
  };

  const roleLabel = (role) => {
    const map = {
      admin: "Administrator",
      cashier: "Cashier",
      kitchen: "Kitchen",
      manager: "Manager",
      waiter: "Waiter",
      staff: "Staff",
    };
    return map[role] || role;
  };

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">🍽️</div>
            {!sidebarCollapsed && (
              <div>
                <span>{restaurantName || "Restaurant"}</span>
                <small>Restaurant POS</small>
              </div>
            )}
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => item.roles.some((r) => hasRole(r)));
            if (items.length === 0) return null;
            return (
              <div className="sidebar-nav-group" key={group.label}>
                {!sidebarCollapsed && <div className="sidebar-nav-group-label">{group.label}</div>}
                <ul className="sidebar-nav-list">
                  {items.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <li key={item.href} className="sidebar-nav-item">
                        <NavLink
                          to={item.href}
                          end={item.href === "/"}
                          className={({ isActive }) => `sidebar-nav-link ${isActive ? "active" : ""}`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <span className="sidebar-nav-icon">
                            <ItemIcon />
                          </span>
                          {!sidebarCollapsed && <span className="sidebar-nav-label">{item.name}</span>}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{getInitials(user?.name)}</div>
            {!sidebarCollapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user?.name}</div>
                <div className="sidebar-user-role">{roleLabel(user?.role)}</div>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={handleLogout}
              className="btn btn-ghost btn-sm sidebar-logout"
              style={{ width: "100%", marginTop: "var(--space-2)", color: "#9fb9b5" }}
            >
              <IconLogout size={16} />
              Logout
            </button>
          )}
        </div>
      </aside>

      {sidebarOpen && isMobileViewport() && <div className="sidebar-overlay visible" onClick={() => setSidebarOpen(false)} />}

      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <button className="mobile-menu-btn icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <IconMenuBurger />
            </button>

            <div className="header-search" ref={searchRef}>
              <IconSearch className="header-search-icon" />
              <input
                type="text"
                className="header-search-input"
                placeholder="Search orders, menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.trim() && setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
              />
              {searchOpen && (
                <div className="header-search-dropdown">
                  {searchLoading ? (
                    <div className="header-search-status">Searching...</div>
                  ) : searchResults.length === 0 ? (
                    <div className="header-search-status">No results found</div>
                  ) : (
                    <div className="header-search-results">
                      {searchResults.some((r) => r.type === "order") && (
                        <>
                          <div className="header-search-group-label">Orders</div>
                          {searchResults
                            .filter((r) => r.type === "order")
                            .map((order) => (
                              <button
                                key={`order-${order._id}`}
                                className="header-search-item"
                                onClick={() => handleSearchResultClick(order)}
                              >
                                <span className="header-search-item-title">
                                  #{order.orderNumber || order._id.slice(-6)}
                                </span>
                                <span className="header-search-item-sub">
                                  {order.customerName || "Walk-in"} &middot; {order.orderStatus}
                                </span>
                              </button>
                            ))}
                        </>
                      )}
                      {searchResults.some((r) => r.type === "menu") && (
                        <>
                          <div className="header-search-group-label">Menu Items</div>
                          {searchResults
                            .filter((r) => r.type === "menu")
                            .map((item) => (
                              <button
                                key={`menu-${item._id}`}
                                className="header-search-item"
                                onClick={() => handleSearchResultClick(item)}
                              >
                                <span className="header-search-item-title">{item.name}</span>
                                <span className="header-search-item-sub">
                                  {item.category?.name || "Menu item"}
                                </span>
                              </button>
                            ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="header-right">
            <div className="header-actions">
              <div className="notif-wrapper" ref={notifRef}>
                <button
                  className={`icon-btn${notifOpen ? " active" : ""}`}
                  aria-label="Notifications"
                  onClick={toggleNotifications}
                >
                  <IconBell />
                  {unreadCount > 0 && (
                    <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="notification-dropdown">
                    <div className="notification-header">
                      <span className="notification-header-title">Notifications</span>
                      {unreadCount > 0 && (
                        <button type="button" className="notification-mark-all" onClick={handleMarkAllRead}>
                          <IconCheck size={14} />
                          Mark all as read
                        </button>
                      )}
                    </div>
                    <div className="notification-list">
                      {notifLoading && <div className="notification-empty">Loading…</div>}
                      {!notifLoading && notifications.length === 0 && (
                        <div className="notification-empty">No notifications</div>
                      )}
                      {notifications.map((n) => (
                        <button
                          key={n._id}
                          className={`notification-item${n.read ? "" : " unread"}`}
                          onClick={() => handleNotificationClick(n)}
                        >
                          <span className={`notification-icon type-${n.type || "system"}`}>
                            {notifIcon(n.type)}
                          </span>
                          <span className="notification-body">
                            <span className="notification-title">{n.title}</span>
                            {n.message && <span className="notification-message">{n.message}</span>}
                            <span className="notification-time">{timeAgo(n.createdAt)}</span>
                          </span>
                          {!n.read && <span className="notification-dot" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="user-menu">
              <button className="user-menu-btn" aria-label="User menu" onClick={handleUserMenuToggle}>
                <div className="user-menu-avatar">{getInitials(user?.name)}</div>
                <span className="user-menu-name">{user?.name}</span>
              </button>
              {userMenuOpen && (
                <div className="user-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div className="user-menu-item" onClick={handleSettingsClick}>
                    <IconGear />
                    Settings
                  </div>
                  <div className="user-menu-divider" />
                  <button className="user-menu-item danger" onClick={handleLogout}>
                    <IconLogout />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

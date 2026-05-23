"use client";

import { useState } from "react";

// Inline SVGs for lightweight, premium, zero-dependency icon rendering
const Icons = {
  Dashboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  Orders: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  Devices: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Flame: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  ChevronRight: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  TrendUp: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  Timer: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
};

type OrderStatus = "PENDIENTE" | "PREPARANDO" | "LISTO" | "ENTREGADO";

interface OrderItem {
  qty: number;
  name: string;
  notes?: string;
}

interface Order {
  id: string;
  time: string;
  table: string;
  items: OrderItem[];
  status: OrderStatus;
  urgency: "Bajo" | "Medio" | "Alto";
}

interface Device {
  name: string;
  station: string;
  status: "ONLINE" | "OFFLINE" | "ALERT";
  uptime: string;
  ping: number;
}

export default function DashboardHome() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "orders" | "devices" | "settings">("dashboard");
  const [glowEnabled, setGlowEnabled] = useState<boolean>(true);
  const [glassIntensity, setGlassIntensity] = useState<number>(60);
  
  // Real Mock Data for high-fidelity representation
  const [orders, setOrders] = useState<Order[]>([
    {
      id: "TK-302",
      time: "Hace 4 min",
      table: "Mesa 12 (Terraza)",
      status: "PREPARANDO",
      urgency: "Alto",
      items: [
        { qty: 2, name: "Ojo de Bife Premium (Madurado 45d)" },
        { qty: 1, name: "Papas Rústicas con Trufa & Parmesano", notes: "Bien crujientes" },
        { qty: 2, name: "Malbec Gran Reserva (Copa)" }
      ]
    },
    {
      id: "TK-303",
      time: "Hace 8 min",
      table: "Barra Puesto 3",
      status: "PENDIENTE",
      urgency: "Medio",
      items: [
        { qty: 1, name: "Ravioles de Calabaza Cabutia y Amaretti" },
        { qty: 1, name: "Copa de Chardonnay Orgánico" }
      ]
    },
    {
      id: "TK-301",
      time: "Hace 15 min",
      table: "Mesa 5 (VIP)",
      status: "LISTO",
      urgency: "Alto",
      items: [
        { qty: 1, name: "Salmón Rosado con Costra de Hierbas" },
        { qty: 1, name: "Puré de Coliflor Ahumado" },
        { qty: 1, name: "Volcán de Chocolate Amargo 70%" }
      ]
    },
    {
      id: "TK-299",
      time: "Hace 22 min",
      table: "Mesa 18",
      status: "ENTREGADO",
      urgency: "Bajo",
      items: [
        { qty: 2, name: "Hamburguesa Gourmet Blend 200g" },
        { qty: 1, name: "Cerveza Patagonia Amber (Pinta)" }
      ]
    }
  ]);

  const devices: Device[] = [
    { name: "Kitchen-Tab-01", station: "Estación de Fuegos", status: "ONLINE", uptime: "14h 32m", ping: 12 },
    { name: "Kitchen-Tab-02", station: "Estación de Fríos y Ensaladas", status: "ONLINE", uptime: "14h 28m", ping: 16 },
    { name: "Kitchen-Tab-03", station: "Pastelería & Postres", status: "ONLINE", uptime: "09h 15m", ping: 24 },
    { name: "Kitchen-Tab-04", station: "Estación de Despacho", status: "ONLINE", uptime: "14h 34m", ping: 8 },
    { name: "Kitchen-Display-Main", station: "Pantalla Central KDS", status: "ALERT", uptime: "02h 11m", ping: 145 },
    { name: "Kitchen-Tab-Backup", station: "Móvil Auxiliar (Entradas)", status: "OFFLINE", uptime: "0h 0m", ping: 0 }
  ];

  // Helper to change order states reactively
  const handleNextStatus = (orderId: string) => {
    setOrders(prev => prev.map(order => {
      if (order.id === orderId) {
        let next: OrderStatus = "PENDIENTE";
        if (order.status === "PENDIENTE") next = "PREPARANDO";
        else if (order.status === "PREPARANDO") next = "LISTO";
        else if (order.status === "LISTO") next = "ENTREGADO";
        else next = "PENDIENTE";
        return { ...order, status: next };
      }
      return order;
    }));
  };

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case "PENDIENTE":
        return <span className="badge badge-warning"><span className="badge-dot" />Pendiente</span>;
      case "PREPARANDO":
        return <span className="badge badge-info"><span className="badge-dot" />Preparando</span>;
      case "LISTO":
        return <span className="badge badge-success"><span className="badge-dot" />Listo</span>;
      case "ENTREGADO":
        return <span className="badge badge-danger" style={{ background: "hsl(var(--slate-800))", color: "var(--text-muted)", borderColor: "transparent" }}>Entregado</span>;
    }
  };

  return (
    <div className="app-container" style={{
      backgroundImage: glowEnabled ? undefined : "none",
      backgroundBlendMode: "normal"
    }}>
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Icons.Flame />
          </div>
          <div className="sidebar-logo-text">
            Cocina<span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>Core</span>
          </div>
          <span className="sidebar-logo-tag">OS</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2.5rem", flexGrow: 1 }}>
          <div>
            <span className="text-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, paddingLeft: "0.75rem", display: "block", marginBottom: "0.75rem" }}>
              Navegación
            </span>
            <ul className="sidebar-menu">
              <li className={activeTab === "dashboard" ? "sidebar-item-active" : ""}>
                <a href="#dashboard" onClick={() => setActiveTab("dashboard")} className="sidebar-item-link">
                  <Icons.Dashboard />
                  Panel Principal
                </a>
              </li>
              <li className={activeTab === "orders" ? "sidebar-item-active" : ""}>
                <a href="#orders" onClick={() => setActiveTab("orders")} className="sidebar-item-link">
                  <Icons.Orders />
                  Cola de Tickets
                  <span className="badge badge-info" style={{ marginLeft: "auto", padding: "1px 6px", fontSize: "0.65rem" }}>
                    {orders.filter(o => o.status !== "ENTREGADO").length}
                  </span>
                </a>
              </li>
              <li className={activeTab === "devices" ? "sidebar-item-active" : ""}>
                <a href="#devices" onClick={() => setActiveTab("devices")} className="sidebar-item-link">
                  <Icons.Devices />
                  Hub de Pantallas
                  <span className="badge badge-success" style={{ marginLeft: "auto", padding: "1px 6px", fontSize: "0.65rem", background: "hsl(var(--accent-success-hsl) / 0.1)", color: "hsl(var(--accent-success-hsl))" }}>
                    {devices.filter(d => d.status === "ONLINE").length}
                  </span>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <span className="text-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, paddingLeft: "0.75rem", display: "block", marginBottom: "0.75rem" }}>
              Ajustes
            </span>
            <ul className="sidebar-menu">
              <li className={activeTab === "settings" ? "sidebar-item-active" : ""}>
                <a href="#settings" onClick={() => setActiveTab("settings")} className="sidebar-item-link">
                  <Icons.Settings />
                  Diseño Visual
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">CD</div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">Chef Demian</span>
              <span className="sidebar-user-role">Executive Chef</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="main-wrapper">
        <header className="top-bar">
          <div>
            <p className="text-muted" style={{ fontSize: "0.9rem", fontWeight: 500, letterSpacing: "-0.01em" }}>
              Restaurante Central • Cocina 1
            </p>
            <h1 className="animate-fade-in">
              {activeTab === "dashboard" && "Dashboard General"}
              {activeTab === "orders" && "Cola de Tickets Activos"}
              {activeTab === "devices" && "Pantallas & Estaciones KDS"}
              {activeTab === "settings" && "Configuración Visual"}
            </h1>
          </div>

          {/* Quick Stats Panel Top Bar */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <span className="badge badge-success" style={{ padding: "6px 12px", border: "1px solid hsl(var(--accent-success-hsl) / 0.3)" }}>
              <span className="badge-dot" style={{ animation: "pulse 1.5s infinite" }} />
              Servidor Activo
            </span>
            <button 
              onClick={() => {
                const newOrder: Order = {
                  id: `TK-${Math.floor(Math.random() * 900) + 100}`,
                  time: "Hace 1 min",
                  table: `Mesa ${Math.floor(Math.random() * 20) + 1}`,
                  status: "PENDIENTE",
                  urgency: Math.random() > 0.5 ? "Alto" : "Medio",
                  items: [
                    { qty: 1, name: "Entraña Black Angus 350g" },
                    { qty: 1, name: "Provoleta de Cabra Ahumada" }
                  ]
                };
                setOrders(o => [newOrder, ...o]);
              }}
              className="btn btn-primary"
            >
              <Icons.Plus />
              Nuevo Pedido
            </button>
          </div>
        </header>

        {/* Tab Content 1: Dashboard Panel */}
        {activeTab === "dashboard" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xl)" }}>
            {/* Stat Cards Grid */}
            <div className="dashboard-grid">
              <div className="card stat-card">
                <div className="stat-header">
                  <span>Tickets Activos</span>
                  <div className="stat-icon"><Icons.Orders /></div>
                </div>
                <div className="stat-value">{orders.filter(o => o.status !== "ENTREGADO").length}</div>
                <div className="stat-change stat-change-up">
                  <Icons.TrendUp />
                  <span>+12.4% vs hora anterior</span>
                </div>
              </div>

              <div className="card stat-card card-cyan">
                <div className="stat-header">
                  <span>Eficiencia Prep.</span>
                  <div className="stat-icon" style={{ color: "hsl(var(--accent-secondary-hsl))" }}><Icons.Timer /></div>
                </div>
                <div className="stat-value">11.8m</div>
                <div className="stat-change stat-change-up" style={{ color: "hsl(var(--accent-secondary-hsl))" }}>
                  <Icons.TrendUp />
                  <span>-2.1m (Más Snappy)</span>
                </div>
              </div>

              <div className="card stat-card">
                <div className="stat-header">
                  <span>Dispositivos KDS</span>
                  <div className="stat-icon"><Icons.Devices /></div>
                </div>
                <div className="stat-value">5 / 6</div>
                <div className="stat-change text-muted" style={{ display: "flex", gap: "6px" }}>
                  <span className="badge-dot" style={{ backgroundColor: "hsl(var(--accent-warning-hsl))" }} />
                  <span>1 pantalla requiere atención</span>
                </div>
              </div>

              <div className="card stat-card">
                <div className="stat-header">
                  <span>Ocupación de Cocina</span>
                  <div className="stat-icon"><Icons.Flame /></div>
                </div>
                <div className="stat-value">84%</div>
                <div className="stat-change stat-change-down">
                  <span style={{ color: "hsl(var(--accent-warning-hsl))", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    ⚡ Carga Pico de Trabajo
                  </span>
                </div>
              </div>
            </div>

            {/* Split Content Row */}
            <div className="content-row">
              {/* Left Column: Urgent Ticket Board preview */}
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ fontFamily: "var(--font-outfit)", fontSize: "1.25rem" }}>Cola de Tickets Prioritarios</h3>
                    <p className="text-muted" style={{ fontSize: "0.85rem" }}>Tickets ordenados según hora de ingreso y prioridad de despacho</p>
                  </div>
                  <button onClick={() => setActiveTab("orders")} className="btn btn-ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}>
                    Ver todos <Icons.ChevronRight />
                  </button>
                </div>

                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Origen</th>
                        <th>Artículos / Pedido</th>
                        <th>Estado</th>
                        <th>Despachar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 3).map((order) => (
                        <tr key={order.id}>
                          <td style={{ fontWeight: 700, fontFamily: "var(--font-outfit)", color: "var(--text-primary)" }}>{order.id}</td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span style={{ fontWeight: 500 }}>{order.table}</span>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                                <Icons.Timer /> {order.time}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              {order.items.map((item, idx) => (
                                <span key={idx} style={{ fontSize: "0.85rem" }}>
                                  <strong style={{ color: "hsl(var(--accent-primary-hsl))" }}>{item.qty}x</strong> {item.name}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{getStatusBadge(order.status)}</td>
                          <td>
                            <button onClick={() => handleNextStatus(order.id)} className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
                              <Icons.Check />
                              {order.status === "PENDIENTE" && "Preparar"}
                              {order.status === "PREPARANDO" && "Listo"}
                              {order.status === "LISTO" && "Entregar"}
                              {order.status === "ENTREGADO" && "Reiniciar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Column: Mini Settings & Visuals Quick Hub */}
              <div className="card card-cyan" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <h3 style={{ fontFamily: "var(--font-outfit)", fontSize: "1.15rem" }}>Ajustes del KDS</h3>
                <p className="text-muted" style={{ fontSize: "0.85rem" }}>Control visual del sistema operativo de cocina en tiempo real.</p>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.5rem" }}>
                  <div className="form-toggle">
                    <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Efecto Neón / Glow</span>
                    <label className="switch">
                      <input type="checkbox" checked={glowEnabled} onChange={() => setGlowEnabled(!glowEnabled)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <div className="form-toggle">
                    <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Brillo de Vidrio</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{glassIntensity}%</span>
                      <input 
                        type="range" 
                        min="20" 
                        max="90" 
                        value={glassIntensity} 
                        onChange={(e) => setGlassIntensity(Number(e.target.value))} 
                        style={{ accentColor: "hsl(var(--accent-secondary-hsl))", width: "80px" }} 
                      />
                    </div>
                  </div>
                </div>

                <div style={{ background: "hsl(var(--slate-950) / 0.5)", border: "1px solid hsl(var(--slate-800) / 0.5)", borderRadius: "var(--radius-md)", padding: "1rem", marginTop: "auto" }}>
                  <span className="text-muted" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "4px" }}>ESPECIFICACIÓN TÉCNICA</span>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    Desarrollado en <strong>Vanilla CSS</strong> con variables de HSL para rendimiento extremo y animación libre de retraso (Zero Lag).
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 2: Orders Ticket Queue */}
        {activeTab === "orders" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xl)" }}>
            {/* Filter Tabs */}
            <div className="tabs-container">
              <button className="tab-btn tab-btn-active">Todos ({orders.length})</button>
              <button className="tab-btn" onClick={() => setActiveTab("dashboard")}>Pendientes ({orders.filter(o => o.status === "PENDIENTE").length})</button>
              <button className="tab-btn" onClick={() => setActiveTab("dashboard")}>En Cocción ({orders.filter(o => o.status === "PREPARANDO").length})</button>
              <button className="tab-btn" onClick={() => setActiveTab("dashboard")}>Listos para Despacho ({orders.filter(o => o.status === "LISTO").length})</button>
            </div>

            {/* Premium Ticket Board Grid */}
            <div className="ticket-list">
              {orders.map((order) => (
                <div key={order.id} className={`card ticket-card ${order.urgency === "Alto" && order.status === "PREPARANDO" ? "card-cyan" : ""}`} style={{
                  borderLeft: order.urgency === "Alto" ? "4px solid hsl(var(--accent-danger-hsl))" : "1px solid var(--border-color)",
                }}>
                  <div className="ticket-header">
                    <div>
                      <span className="ticket-number">{order.id}</span>
                      <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginTop: "2px" }}>{order.table}</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                      {getStatusBadge(order.status)}
                      <span className="ticket-time">
                        <Icons.Timer />
                        {order.time}
                      </span>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="ticket-items">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="ticket-item">
                        <div>
                          <span className="ticket-item-qty">{item.qty}x</span>
                          <span className="ticket-item-name">{item.name}</span>
                          {item.notes && <p className="ticket-item-notes">• {item.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer Actions */}
                  <div className="ticket-footer">
                    <div>
                      <span className="text-muted" style={{ fontSize: "0.7rem", fontWeight: 700, display: "block" }}>PRIORIDAD</span>
                      <span style={{ 
                        fontSize: "0.8rem", 
                        fontWeight: 700, 
                        color: order.urgency === "Alto" ? "hsl(var(--accent-danger-hsl))" : order.urgency === "Medio" ? "hsl(var(--accent-warning-hsl))" : "hsl(var(--accent-success-hsl))" 
                      }}>
                        {order.urgency}
                      </span>
                    </div>

                    <button 
                      onClick={() => handleNextStatus(order.id)} 
                      className="btn btn-primary"
                      style={{ 
                        padding: "0.5rem 1rem", 
                        fontSize: "0.85rem",
                        background: order.status === "LISTO" ? "linear-gradient(135deg, hsl(var(--accent-success-hsl)), hsl(var(--accent-success-hsl) / 0.85))" : undefined,
                        boxShadow: order.status === "LISTO" ? "0 4px 12px hsl(var(--accent-success-hsl) / 0.2)" : undefined
                      }}
                    >
                      <Icons.Check />
                      {order.status === "PENDIENTE" && "Iniciar Preparación"}
                      {order.status === "PREPARANDO" && "Terminar Cocción"}
                      {order.status === "LISTO" && "Completar Despacho"}
                      {order.status === "ENTREGADO" && "Volver a Abrir"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Content 3: KDS Screens / Devices */}
        {activeTab === "devices" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xl)" }}>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <div>
                  <h3 style={{ fontFamily: "var(--font-outfit)", fontSize: "1.25rem" }}>Dispositivos y Pantallas de Cocina</h3>
                  <p className="text-muted" style={{ fontSize: "0.85rem" }}>Estaciones KDS (Kitchen Display System) monitoreadas mediante WebSockets en tiempo real.</p>
                </div>
                <span className="badge badge-success" style={{ background: "hsl(var(--accent-success-hsl) / 0.1)", color: "hsl(var(--accent-success-hsl))" }}>
                  Todos los hubs listos
                </span>
              </div>

              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>ID Terminal</th>
                      <th>Estación Asignada</th>
                      <th>Estado</th>
                      <th>Tiempo Activo</th>
                      <th>Latencia / Red</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((dev, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700, fontFamily: "var(--font-outfit)" }}>{dev.name}</td>
                        <td><span style={{ fontWeight: 500 }}>{dev.station}</span></td>
                        <td>
                          {dev.status === "ONLINE" && <span className="badge badge-success"><span className="badge-dot" />Online</span>}
                          {dev.status === "ALERT" && <span className="badge badge-warning" style={{ animation: "pulse 2s infinite" }}><span className="badge-dot" />Revisar Red</span>}
                          {dev.status === "OFFLINE" && <span className="badge badge-danger"><span className="badge-dot" />Desconectado</span>}
                        </td>
                        <td>{dev.uptime}</td>
                        <td>
                          {dev.status !== "OFFLINE" ? (
                            <span style={{ 
                              color: dev.ping < 30 ? "hsl(var(--accent-success-hsl))" : dev.ping < 100 ? "hsl(var(--accent-warning-hsl))" : "hsl(var(--accent-danger-hsl))",
                              fontWeight: 600
                            }}>
                              {dev.ping} ms
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>
                            Ping
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 4: Visual Settings & Customizer */}
        {activeTab === "settings" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xl)", maxWidth: "800px" }}>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <h3 style={{ fontFamily: "var(--font-outfit)", fontSize: "1.25rem" }}>Configuración del Sistema de Diseño Visual</h3>
                <p className="text-muted" style={{ fontSize: "0.85rem" }}>Controlá las variables HSL de Vanilla CSS en caliente. Todos los ajustes se reflejan de inmediato.</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-group">
                  <label className="form-label">Tema de Diseño Seleccionado</label>
                  <select className="form-input" style={{ width: "100%", background: "hsl(var(--slate-950))" }}>
                    <option value="slate-premium">Slate Premium Oscuro (Por Defecto)</option>
                    <option value="carbon-midnight" disabled>Carbon Midnight (Próximamente)</option>
                    <option value="emerald-aurora" disabled>Emerald Aurora (Próximamente)</option>
                  </select>
                </div>

                <div className="form-toggle">
                  <div>
                    <span style={{ fontSize: "0.95rem", fontWeight: 600, display: "block" }}>Habilitar Efectos Neon & Glow</span>
                    <span className="text-muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "2px" }}>Agrega una sutil sombra difuminada con el color de acento HSL a las tarjetas al pasar el cursor.</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={glowEnabled} onChange={() => setGlowEnabled(!glowEnabled)} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="form-toggle">
                  <div>
                    <span style={{ fontSize: "0.95rem", fontWeight: 600, display: "block" }}>Fondo Traslúcido de Vidrio (Glassmorphism)</span>
                    <span className="text-muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "2px" }}>Modifica la intensidad del blur de fondo en los componentes flotantes.</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "hsl(var(--accent-secondary-hsl))" }}>{glassIntensity}px</span>
                    <input 
                      type="range" 
                      min="20" 
                      max="90" 
                      value={glassIntensity} 
                      onChange={(e) => setGlassIntensity(Number(e.target.value))} 
                      style={{ accentColor: "hsl(var(--accent-secondary-hsl))" }} 
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                  <button className="btn btn-primary" onClick={() => alert("Ajustes guardados correctamente en localStorage")}>
                    Guardar Cambios
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setGlowEnabled(true); setGlassIntensity(60); }}>
                    Restablecer Valores
                  </button>
                </div>
              </div>
            </div>
            
            <div className="card card-cyan" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <h3 style={{ fontFamily: "var(--font-outfit)", fontSize: "1.15rem" }}>Consola de Diagnóstico HSL</h3>
              <p className="text-muted" style={{ fontSize: "0.85rem" }}>Lectura en tiempo real de los tokens de color inyectados en el DOM:</p>
              
              <div style={{ 
                background: "hsl(var(--slate-950) / 0.8)", 
                borderRadius: "var(--radius-md)", 
                padding: "1rem", 
                fontFamily: "monospace", 
                fontSize: "0.85rem",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                border: "1px solid hsl(var(--slate-800))"
              }}>
                <div><span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>--bg-app</span>: hsl(222, 47%, 6%) <span style={{ color: "var(--text-muted)" }}>#030712</span></div>
                <div><span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>--accent-primary-hsl</span>: 250, 85%, 64% <span style={{ color: "var(--text-muted)" }}>#6366f1</span></div>
                <div><span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>--accent-secondary-hsl</span>: 195, 90%, 50% <span style={{ color: "var(--text-muted)" }}>#06b6d4</span></div>
                <div><span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>--glass-intensity</span>: {glassIntensity}px <span style={{ color: "var(--text-muted)" }}>backdrop-filter</span></div>
                <div><span style={{ color: "hsl(var(--accent-secondary-hsl))" }}>--glow-effect</span>: {glowEnabled ? "Active" : "Inactive"}</div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Dynamic inline styles to apply local state variables directly to the CSS engine */}
      <style jsx global>{`
        :root {
          --glass-backdrop: blur(${glassIntensity}px);
        }
      `}</style>
    </div>
  );
}

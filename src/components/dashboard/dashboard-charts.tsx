"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

const COLORS = ["#059669", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

interface Props {
  cobrancas: Array<{
    valor: number;
    status: string;
    vencimento: string;
    data_pagamento: string | null;
  }>;
  beneficiarios: Array<{
    status_totalpass: string;
    plano: string | null;
    perfil: string;
  }>;
}

export function DashboardCharts({ cobrancas, beneficiarios }: Props) {
  const receitaMensal = cobrancas.reduce<Record<string, number>>((acc, c) => {
    if (!["RECEIVED", "CONFIRMED"].includes(c.status)) return acc;
    const mes = c.vencimento?.slice(0, 7) ?? "N/A";
    acc[mes] = (acc[mes] ?? 0) + Number(c.valor);
    return acc;
  }, {});

  const receitaData = Object.entries(receitaMensal).map(([mes, valor]) => ({
    mes,
    valor,
  }));

  const planoData = beneficiarios.reduce<Record<string, number>>((acc, b) => {
    const plano = b.plano || "Sem plano";
    acc[plano] = (acc[plano] ?? 0) + 1;
    return acc;
  }, {});

  const planoChart = Object.entries(planoData).map(([name, value]) => ({
    name,
    value,
  }));

  const statusChart = [
    {
      status: "Ativo",
      titulares: beneficiarios.filter(
        (b) => b.perfil === "titular" && b.status_totalpass === "ativo"
      ).length,
      dependentes: beneficiarios.filter(
        (b) => b.perfil === "dependente" && b.status_totalpass === "ativo"
      ).length,
    },
    {
      status: "Elegível",
      titulares: beneficiarios.filter(
        (b) => b.perfil === "titular" && b.status_totalpass === "elegivel"
      ).length,
      dependentes: beneficiarios.filter(
        (b) => b.perfil === "dependente" && b.status_totalpass === "elegivel"
      ).length,
    },
    {
      status: "Inativo",
      titulares: beneficiarios.filter(
        (b) => b.perfil === "titular" && b.status_totalpass === "inativo"
      ).length,
      dependentes: beneficiarios.filter(
        (b) => b.perfil === "dependente" && b.status_totalpass === "inativo"
      ).length,
    },
  ];

  const pagamentosData = cobrancas
    .filter((c) => c.data_pagamento)
    .reduce<Record<string, number>>((acc, c) => {
      const mes = c.data_pagamento!.slice(0, 7);
      acc[mes] = (acc[mes] ?? 0) + Number(c.valor);
      return acc;
    }, {});

  const pagamentosChart = Object.entries(pagamentosData).map(([mes, valor]) => ({
    mes,
    valor,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Receita mensal">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={receitaData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `R$ ${Number(v).toFixed(2)}`} />
            <Bar dataKey="valor" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Clientes por plano">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={planoChart}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label
            >
              {planoChart.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Status por perfil">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={statusChart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="status" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="titulares" name="Titulares" fill="#059669" radius={[4, 4, 0, 0]} />
            <Bar dataKey="dependentes" name="Dependentes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Pagamentos recebidos">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={pagamentosChart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `R$ ${Number(v).toFixed(2)}`} />
            <Line type="monotone" dataKey="valor" stroke="#059669" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

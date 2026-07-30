// Dashboard Ranking Preview - Shows Top 5 summary cards

import React from 'react';
import { Trophy, AlertTriangle, TrendingUp, Clock, ArrowRight, Award } from 'lucide-react';

interface BrandRow {
  id: string;
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  status: string;
}

interface RankingItem {
  nome: string;
  valor: string;
}

interface DashboardRankingPreviewProps {
  melhores: RankingItem[];
  piores: RankingItem[];
  inProgress: BrandRow[];
  onViewAll: () => void;
}

const TOP_N = 5;

const MedalBadge = ({ rank }: { rank: number }) => (
  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold flex-shrink-0 ${
    rank === 1 ? 'bg-amber-400 text-white' :
    rank === 2 ? 'bg-zinc-300 text-zinc-700' :
    rank === 3 ? 'bg-amber-700 text-white' :
    'bg-zinc-100 text-zinc-500'
  }`}>{rank}</span>
);

export const DashboardRankingPreview: React.FC<DashboardRankingPreviewProps> = ({
  melhores,
  piores,
  inProgress,
  onViewAll,
}) => {
  const top5Best = melhores.slice(0, TOP_N);
  const top5Worst = piores.slice(0, TOP_N);
  const top5Progress = inProgress.slice(0, TOP_N);

  return (
    <div className="space-y-4">
      {/* View All button */}
      <button
        onClick={onViewAll}
        className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
      >
        <Trophy size={18} className="text-amber-400" />
        Ver Rankings Completos
        <ArrowRight size={16} className="ml-auto text-zinc-400" />
      </button>

      {/* Top 5 Melhor Acuracidade */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="bg-emerald-50 px-4 py-3 border-b border-emerald-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
            <Trophy size={16} className="text-emerald-600" />
            Top {TOP_N} Melhores
          </h3>
          <button
            onClick={onViewAll}
            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1"
          >
            Ver todos <ArrowRight size={12} />
          </button>
        </div>
        {top5Best.length === 0 ? (
          <p className="px-4 py-3 text-xs text-zinc-400">Nenhuma linha concluida ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {top5Best.map((m, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-3 py-2 flex items-center gap-2 text-zinc-700 min-w-0">
                    <MedalBadge rank={i + 1} />
                    <span className="truncate">{m.nome}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-600 whitespace-nowrap">{m.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {melhores.length > TOP_N && (
          <button
            onClick={onViewAll}
            className="w-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition flex items-center justify-center gap-1 border-t border-zinc-100"
          >
            + {melhores.length - TOP_N} mais <ArrowRight size={11} />
          </button>
        )}
      </div>

      {/* Top 5 Piores Acuracidade */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="bg-red-50 px-4 py-3 border-b border-red-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            Top {TOP_N} Criticas
          </h3>
          <button
            onClick={onViewAll}
            className="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
          >
            Ver todos <ArrowRight size={12} />
          </button>
        </div>
        {top5Worst.length === 0 ? (
          <p className="px-4 py-3 text-xs text-zinc-400">Nenhuma linha concluida ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {top5Worst.map((m, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-3 py-2 text-zinc-700 truncate max-w-[160px]">{m.nome}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600 whitespace-nowrap">{m.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {piores.length > TOP_N && (
          <button
            onClick={onViewAll}
            className="w-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition flex items-center justify-center gap-1 border-t border-zinc-100"
          >
            + {piores.length - TOP_N} mais <ArrowRight size={11} />
          </button>
        )}
      </div>

      {/* Em Andamento */}
      {top5Progress.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" />
              Em Andamento
            </h3>
            <button
              onClick={onViewAll}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1"
            >
              Ver todos <ArrowRight size={12} />
            </button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {top5Progress.map((b) => (
                <tr key={b.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-3 py-2 text-zinc-700 truncate max-w-[160px]">{b.brand}</td>
                  <td className="px-3 py-2 text-center text-xs text-zinc-400">{b.doneSku}/{b.totalSku}</td>
                  <td className="px-3 py-2 text-right font-bold text-amber-600 whitespace-nowrap">{b.progress.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inProgress.length > TOP_N && (
            <button
              onClick={onViewAll}
              className="w-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition flex items-center justify-center gap-1 border-t border-zinc-100"
            >
              + {inProgress.length - TOP_N} mais <ArrowRight size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

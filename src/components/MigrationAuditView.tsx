import React, { useState } from 'react';
import {
  ENV_RECONCILIATION_MATRIX,
  MIGRATION_MATRIX,
  MigrationAction,
  WORKING_REQUEST_PATH,
} from '../data/migrationAuditData';

export const MigrationAuditView: React.FC = () => {
  const [filterAction, setFilterAction] = useState<'ALL' | 'FAILURE_CAUSES' | MigrationAction>('ALL');

  const filteredRows = MIGRATION_MATRIX.filter((row) => {
    if (filterAction === 'ALL') return true;
    if (filterAction === 'FAILURE_CAUSES') return row.contributesToFailure;
    return row.action === filterAction;
  });

  return (
    <div className="space-y-10">
      {/* 1. Working Request Path */}
      <section className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-xs">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-normal text-slate-900 font-editorial">
            01. Reconciled Working Request Path
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            Authoritative end-to-end execution path transplanted from the known-good analyzer and adapted to the current CYFSA Navigator production infrastructure.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {WORKING_REQUEST_PATH.map((node) => (
            <div
              key={node.step}
              className="p-4 border border-slate-200/80 rounded-md bg-[#FAF8F5]/60 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-xs font-mono text-slate-500 tabular-nums">
                  <span>STEP {String(node.step).padStart(2, '0')}</span>
                  <span className="font-semibold text-[#1E3A5F]">{node.stage}</span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-slate-900">{node.title}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{node.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. 30-Point Migration Matrix */}
      <section className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200/80">
          <div>
            <h2 className="text-2xl font-normal text-slate-900 font-editorial">
              02. Known-Good vs. Current Analyzer Migration Matrix (30 Components)
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Component-by-component forensic comparison identifying root-cause failure contributors and exact migration actions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            {[
              { id: 'ALL', label: 'All (30)' },
              { id: 'FAILURE_CAUSES', label: 'Failure Contributors (24)' },
              { id: 'TRANSPLANT KNOWN-GOOD', label: 'Transplant Known-Good' },
              { id: 'REPLACE', label: 'Replace' },
              { id: 'MERGE', label: 'Merge' },
              { id: 'KEEP CURRENT', label: 'Keep Current' },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilterAction(btn.id as any)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  filterAction === btn.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 pr-3 font-medium">Component</th>
                <th className="py-3 px-3 font-medium">Known-Good Implementation</th>
                <th className="py-3 px-3 font-medium">Prior Current Implementation</th>
                <th className="py-3 px-3 font-medium">Difference & Root-Cause Impact</th>
                <th className="py-3 px-3 font-medium">Action</th>
                <th className="py-3 pl-3 font-medium">Production Reconciliation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {filteredRows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="py-3.5 pr-3 font-semibold text-slate-900 whitespace-nowrap">
                    {row.component}
                  </td>
                  <td className="py-3.5 px-3 text-slate-700 leading-relaxed">
                    {row.knownGoodImplementation}
                  </td>
                  <td className="py-3.5 px-3 text-slate-600 leading-relaxed">
                    {row.currentImplementation}
                  </td>
                  <td className="py-3.5 px-3 text-slate-700 leading-relaxed">
                    {row.contributesToFailure ? (
                      <span className="font-semibold text-[#991B1B]">Root-Cause Failure: </span>
                    ) : (
                      <span className="font-semibold text-slate-500">Non-Breaking: </span>
                    )}
                    {row.difference}
                  </td>
                  <td className="py-3.5 px-3 font-mono font-semibold text-[#1E3A5F] whitespace-nowrap">
                    {row.action}
                  </td>
                  <td className="py-3.5 pl-3 text-slate-700 leading-relaxed">
                    {row.reconciliationDetail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Environment Variable Mapping */}
      <section className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-xs">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-normal text-slate-900 font-editorial">
            03. Environment-Variable & Credential Reconciliation Mapping
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            Maps required credential variable names across Known-Good and Authoritative CYFSA Navigator environments. Secret values are never printed, logged, or bundled into client code.
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-3 font-medium">Known-Good Variable Name</th>
                <th className="py-2.5 px-3 font-medium">Authoritative Current Variable Name</th>
                <th className="py-2.5 px-3 font-medium">Target Service / Project</th>
                <th className="py-2.5 px-3 font-medium">Required Runtime</th>
                <th className="py-2.5 px-3 font-medium">Server or Client</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 pl-3 font-medium">Deterministic Resolution Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {ENV_RECONCILIATION_MATRIX.map((env, idx) => (
                <tr key={idx} className="align-top">
                  <td className="py-3 pr-3 font-mono text-slate-800">{env.knownGoodVar}</td>
                  <td className="py-3 px-3 font-mono font-semibold text-[#1E3A5F]">
                    {env.currentVar}
                  </td>
                  <td className="py-3 px-3 text-slate-700">{env.serviceBelongsTo}</td>
                  <td className="py-3 px-3 text-slate-600">{env.requiredRuntime}</td>
                  <td className="py-3 px-3 font-mono text-slate-700">{env.scope}</td>
                  <td className="py-3 px-3 font-semibold text-[#166534]">{env.status}</td>
                  <td className="py-3 pl-3 text-slate-600 leading-relaxed">{env.resolutionRule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

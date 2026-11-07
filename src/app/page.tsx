export default function Home() {
  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="border border-slate-700 bg-slate-800 rounded-lg p-6 shadow-md">
        <h1 className="text-2xl font-bold text-teal-400 mb-2">TrickleSettle</h1>
        <p className="text-slate-300 mb-4">
          Reliability layer between device usage events and Solana DevNet.
        </p>
        <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-teal-900/50 text-teal-300 border border-teal-700">
          DevNet Mode: Active
        </div>
      </div>
    </main>
  );
}


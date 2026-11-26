import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { repairAllSavedGameData } from '../utils/saveRepair';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  repairedSummary: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    repairedSummary: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || 'حدث خلل غير متوقع في واجهة البحيرة',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Self-Healing ErrorBoundary caught runtime error:', error, info.componentStack);
    const report = repairAllSavedGameData();
    this.setState({
      repairedSummary:
        report.repairedCount > 0
          ? `تم فحص وإصلاح ${report.repairedCount} من ملفات الحفظ تلقائياً.`
          : 'تم التحقق من سلامة جميع بيانات التقدم والحفظ.',
    });
  }

  private handleSoftRecover = (): void => {
    repairAllSavedGameData();
    this.setState({
      hasError: false,
      errorMessage: '',
      repairedSummary: null,
    });
  };

  private handleHardReload = (): void => {
    repairAllSavedGameData();
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        dir="rtl"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#091318] text-stone-100 p-6"
      >
        <div className="max-w-md w-full rounded-2xl border border-emerald-400/30 bg-[#0e1c23] p-6 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-stone-50">
                الاستعادة التلقائية لوادي الصيد الهادئ
              </h2>
              <p className="text-xs text-emerald-300/90">
                تم عزل الخلل وحماية بيانات الصيد الخاصة بك
              </p>
            </div>
          </div>

          {this.state.repairedSummary && (
            <div className="rounded-lg bg-emerald-950/50 border border-emerald-400/25 px-3 py-2 text-xs text-emerald-100">
              {this.state.repairedSummary}
            </div>
          )}

          <p className="text-xs text-stone-300 leading-relaxed">
            يمكنك استئناف الجلسة فوراً أو إعادة تحميل المشهد دون فقدان مستواك أو سجل الأسماك.
          </p>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleSoftRecover}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>استعادة الجلسة الآن</span>
            </button>
            <button
              type="button"
              onClick={this.handleHardReload}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      </div>
    );
  }
}

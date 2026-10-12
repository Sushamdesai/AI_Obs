import { AlertCircle, LoaderCircle, Radio, WifiOff } from "lucide-react";

export function LoadingNotice({ label = "Loading live platform data" }: { label?: string }) {
  return (
    <div className="notice loading-notice" role="status">
      <span className="loading-notice-label">
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
        <span>{label}</span>
      </span>
      <span className="loading-skeleton" aria-hidden="true">
        <i /><i /><i />
      </span>
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice notice-error" role="alert">
      <WifiOff size={17} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyNotice({ message }: { message: string }) {
  return (
    <div className="empty-notice">
      <Radio size={18} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function InlineWarning({ message }: { message: string }) {
  return (
    <div className="inline-warning">
      <AlertCircle size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

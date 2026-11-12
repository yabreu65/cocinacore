type LoadErrorNoticeProps = {
  message: string;
};

export default function LoadErrorNotice({ message }: LoadErrorNoticeProps) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 px-3 py-2 text-sm text-bistro-warning"
    >
      {message}
    </p>
  );
}

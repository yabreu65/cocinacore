type LoadErrorNoticeProps = {
  message: string;
};

export default function LoadErrorNotice({ message }: LoadErrorNoticeProps) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      {message}
    </p>
  );
}

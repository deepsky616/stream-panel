interface PageDotsProps {
  count: number;
  page: number;
  onChange: (page: number) => void;
}

export function PageDots({ count, page, onChange }: PageDotsProps) {
  return (
    <div className="page-dots" aria-label="페이지 선택">
      {Array.from({ length: count }, (_, index) => (
        <button
          key={index}
          className={index === page ? 'active' : ''}
          type="button"
          onClick={() => onChange(index)}
          aria-label={`${index + 1}쪽`}
          aria-current={index === page ? 'page' : undefined}
        />
      ))}
    </div>
  );
}

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: string;
}

export default function PlaceholderPage({ title, description, icon = '🚧' }: PlaceholderPageProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="card text-center py-16">
        <span className="text-5xl block mb-4">{icon}</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {title}
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          {description || 'This page is coming soon.'}
        </p>
      </div>
    </div>
  );
}

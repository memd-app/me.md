import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      {/* Header */}
      <header className="border-b border-gray-100 dark:border-dark-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-2xl font-bold text-primary-600">me.md</span>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="btn-primary text-sm"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero section */}
      <section className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className="text-4xl md:text-6xl font-bold text-gray-900 dark:text-white mb-6">
          Your Verified Personal Context
        </h1>
        <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-8 leading-relaxed">
          Build a comprehensive understanding of yourself through AI-guided conversations.
          Make any AI tool write, decide, and act like you — with 95%+ accuracy.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/register" className="btn-primary text-lg px-8 py-3">
            Start Building Your me.md
          </Link>
          <a href="#how-it-works" className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium">
            Learn how it works &darr;
          </a>
        </div>
      </section>

      {/* Three Pillars */}
      <section id="how-it-works" className="bg-gray-50 dark:bg-dark-surface py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-12">
            Three Steps to Your Personal AI Context
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Create',
                description: 'AI-guided interviews using proven questioning methodologies extract your personal knowledge, values, and decision patterns.',
                icon: '💬',
              },
              {
                title: 'Verify',
                description: 'You stay in full control. Review and verify every insight — approve, reject, or edit. Nothing goes into your profile without your approval.',
                icon: '✅',
              },
              {
                title: 'Manage',
                description: 'Export your verified context as a portable me.md file. Any AI tool can use it to truly understand you.',
                icon: '📤',
              },
            ].map((pillar) => (
              <div key={pillar.title} className="card text-center">
                <div className="text-4xl mb-4">{pillar.icon}</div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  {pillar.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {pillar.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value Proposition */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            Why me.md?
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-12 leading-relaxed">
            Most AI memory systems capture 53-67% of who you are. me.md uses structured interviews
            and human verification to achieve 95%+ accuracy — a living knowledge graph of your
            verified personal context.
          </p>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { label: 'Structured Interviews', desc: 'Proven methodologies like Socratic questioning and Clean Language' },
              { label: 'Human-in-the-Loop', desc: 'Every insight verified by you before it becomes part of your profile' },
              { label: 'Knowledge Graph', desc: 'Visual connections between your topics, insights, and concepts' },
              { label: 'Portable Context', desc: 'Export as me.md for any AI tool, or serve via MCP protocol' },
            ].map((item) => (
              <div key={item.label} className="text-left p-4 rounded-lg bg-gray-50 dark:bg-dark-surface">
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">{item.label}</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="bg-primary-600 py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to teach AI who you are?
          </h2>
          <p className="text-primary-100 mb-8 text-lg">
            Join the closed beta and start building your verified personal context.
          </p>
          <Link to="/register" className="inline-block bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors">
            Sign Up for Beta
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-dark-border py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500 dark:text-gray-400">
          &copy; 2026 me.md. Your verified personal context for AI.
        </div>
      </footer>
    </div>
  );
}

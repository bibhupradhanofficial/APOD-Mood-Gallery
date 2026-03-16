import { useState } from 'react'
import { translateApodDescription, askCosmicAgent, getCosmicGlossary } from '../services/geminiService'

export default function SpaceGuideAgent({ apod }) {
  const [style, setStyle] = useState('original')
  const [content, setContent] = useState(apod?.explanation)
  const [loading, setLoading] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [glossary, setGlossary] = useState([])
  const [loadingGlossary, setLoadingGlossary] = useState(false)

  const handleStyleChange = async (newStyle) => {
    if (newStyle === 'original') {
      setContent(apod?.explanation)
      setStyle('original')
      return
    }

    setLoading(true)
    setStyle(newStyle)
    const translated = await translateApodDescription(apod?.explanation, newStyle)
    setContent(translated)
    setLoading(false)
  }

  const handleAsk = async (e) => {
    e.preventDefault()
    if (!question.trim()) return
    setAsking(true)
    const res = await askCosmicAgent(question, apod?.explanation)
    setAnswer(res)
    setAsking(false)
  }

  const handleFetchGlossary = async () => {
    if (glossary.length > 0) return
    setLoadingGlossary(true)
    const terms = await getCosmicGlossary(apod?.explanation)
    setGlossary(terms)
    setLoadingGlossary(false)
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-space-aurora/90 uppercase tracking-wider">Cosmic Mode:</span>
          {['original', 'story', 'deepdive', 'poetic', 'guide'].map((s) => (
            <button
              key={s}
              onClick={() => handleStyleChange(s)}
              className={[
                'px-3 py-1 text-[10px] font-bold rounded-full transition-all border',
                style === s 
                  ? 'bg-space-aurora/20 border-space-aurora/50 text-space-aurora shadow-[0_0_10px_rgba(34,197,94,0.1)]' 
                  : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
              ].join(' ')}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        
        <button
          onClick={handleFetchGlossary}
          disabled={loadingGlossary}
          className="flex items-center gap-2 px-3 py-1 text-[10px] font-bold rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20 transition-all disabled:opacity-50"
        >
          {loadingGlossary ? 'SCANNING...' : 'EXPLORE GLOSSARY 📚'}
        </button>
      </div>

      <div className="relative min-h-[80px]">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-sm text-slate-400 animate-pulse">
            Consulting the cosmic archives...
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-slate-200/90 whitespace-pre-wrap">
            {content}
          </p>
        )}
      </div>

      {glossary.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 animate-in fade-in slide-in-from-top-2 duration-500">
          {glossary.map((g, i) => (
            <div key={i} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 shadow-sm">
              <p className="text-[10px] font-black tracking-widest text-fuchsia-400 uppercase mb-1">{g.term}</p>
              <p className="text-[11px] text-slate-300 leading-snug">{g.definition}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAsk} className="mt-6 pt-4 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask your space guide something..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-space-aurora/30"
          />
          <button
            disabled={asking}
            className="bg-space-aurora/20 hover:bg-space-aurora/30 text-space-aurora px-4 py-2 rounded-xl text-xs font-bold border border-space-aurora/30 transition-all disabled:opacity-50"
          >
            {asking ? 'THINKING...' : 'ASK'}
          </button>
        </div>
        {answer && (
          <div className="mt-3 p-3 bg-white/5 rounded-xl border border-space-aurora/20">
            <p className="text-xs text-space-aurora font-bold mb-1 uppercase tracking-tighter">Guide Response:</p>
            <p className="text-xs text-slate-200 leading-relaxed italic">"{answer}"</p>
          </div>
        )}
      </form>
    </div>
  )
}

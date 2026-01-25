import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildCollectionShareMeta,
  getApodImageUrl,
  copyToClipboard,
  buildShareUrlWithMeta,
  downloadMoodBoardAsPng,
  downloadQrCodePng,
  generateEmbedCode,
  getSocialShareLinks,
} from '../utils'
import {
  listCollections,
  decodeCollectionPayload,
  encodeCollectionPayload,
  getSharePayloadFromLocation,
} from '../services/collectionStore'

// Layout constants
const LAYOUTS = {
  GRID_2X3: 'grid-2x3',
  GRID_3X3: 'grid-3x3',
  GRID_4X3: 'grid-4x3',
  COLLAGE: 'collage',
  TIMELINE: 'timeline',
  GRADIENT: 'gradient',
}

const LAYOUT_LABELS = {
  [LAYOUTS.GRID_2X3]: 'Grid (2x3)',
  [LAYOUTS.GRID_3X3]: 'Grid (3x3)',
  [LAYOUTS.GRID_4X3]: 'Grid (4x3)',
  [LAYOUTS.COLLAGE]: 'Artistic Collage',
  [LAYOUTS.TIMELINE]: 'Timeline',
  [LAYOUTS.GRADIENT]: 'Color Gradient',
}

// Mock popular boards for "Public Gallery"
const POPULAR_BOARDS = [
  {
    id: 'demo-cosmic',
    title: 'Cosmic Dreams',
    subtitle: 'A journey through the stars',
    tags: ['Peaceful', 'Wonder', 'Vast'],
    layout: LAYOUTS.COLLAGE,
    items: [
      { title: 'Nebula 1', url: 'https://apod.nasa.gov/apod/image/2101/2020_12_16_Kujal_Jizni_Pol_1500px-3.jpg', date: '2021-01-01' },
      { title: 'Galaxy 2', url: 'https://apod.nasa.gov/apod/image/2101/WetCollodionLunar112820SMO_1024.jpg', date: '2021-01-02' },
      { title: 'Star Cluster', url: 'https://apod.nasa.gov/apod/image/2101/PhoenixAurora_Helgason_960.jpg', date: '2021-01-03' },
      { title: 'Nebula 4', url: 'https://apod.nasa.gov/apod/image/2101/SMC_Mtanous_960.jpg', date: '2021-01-05' },
      { title: 'Galaxy 5', url: 'https://apod.nasa.gov/apod/image/2101/StripedDunes_HiRISE_1080.jpg', date: '2021-01-06' },
      { title: 'Star Field', url: 'https://apod.nasa.gov/apod/image/2101/Tse_2020_400mm_dmwa-rot.jpg', date: '2021-01-07' },
    ]
  },
  {
    id: 'demo-aurora',
    title: 'Aurora Borealis',
    subtitle: 'Lights of the North',
    tags: ['Energetic', 'Colorful', 'Nature'],
    layout: LAYOUTS.GRID_3X3,
    items: [
        { title: 'Aurora 1', url: 'https://apod.nasa.gov/apod/fap/image/1703/AuroraTree_Wallace_2048.jpg', date: '2017-03-17' },
        { title: 'Aurora 2', url: 'https://apod.nasa.gov/apod/fap/image/1703/AuroraIceland_Brynjarsson_960.jpg', date: '2017-03-03' },
        { title: 'Aurora 3', url: 'https://apod.nasa.gov/apod/fap/image/1703/AuroraIceland_Brynjarsson_960_annotated.jpg', date: '2017-03-03' },
        { title: 'Aurora 4', url: 'https://apod.nasa.gov/apod/fap/image/1605/AuroraSweden_Strand_1500.jpg', date: '2016-05-02' },
        { title: 'Aurora 5', url: 'https://apod.nasa.gov/apod/fap/image/1605/AuroraSweden_Strand_960.jpg', date: '2016-05-02' },
        { title: 'Aurora 6', url: 'https://apod.nasa.gov/apod/fap/image/1509/AuroraIceland_Necchi_1280.jpg', date: '2015-09-11' },
    ]
  }
]

export default function MoodBoardCreator({ initialItems = [] }) {
  // State
  const [items, setItems] = useState(initialItems)
  const [layout, setLayout] = useState(LAYOUTS.GRID_3X3)
  const [title, setTitle] = useState('My Mood Board')
  const [subtitle, setSubtitle] = useState('A collection of cosmic moments')
  const [tags, setTags] = useState(['Cosmic', 'Space', 'Mood'])
  const [tagInput, setTagInput] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareNotice, setShareNotice] = useState(null)
  const [isExporting, setIsExporting] = useState(false)
  const [savedCollections, setSavedCollections] = useState([])
  const [activeTab, setActiveTab] = useState('editor') // 'editor', 'gallery'

  const boardRef = useRef(null)
  const appliedSharePayloadRef = useRef(false)

  const initialItemsSignature = useMemo(() => {
    if (!Array.isArray(initialItems) || initialItems.length === 0) return ''
    return initialItems
      .map((i) => `${i?.date ?? ''}::${i?.title ?? ''}::${i?.url ?? ''}::${i?.hdurl ?? ''}::${i?.media_type ?? ''}`)
      .join('|')
  }, [initialItems])

  const stableInitialItems = useMemo(() => initialItems, [initialItems])

  const itemsSignature = useMemo(() => {
    if (!Array.isArray(items) || items.length === 0) return ''
    return items
      .map((i) => `${i?.date ?? ''}::${i?.title ?? ''}::${i?.url ?? ''}::${i?.hdurl ?? ''}::${i?.media_type ?? ''}`)
      .join('|')
  }, [items])

  // Load collections on mount
  useEffect(() => {
    const collections = listCollections()
    setSavedCollections(collections)
    
    // Check for share payload
    const payload = getSharePayloadFromLocation()
    if (payload) {
        const decoded = decodeCollectionPayload(payload)
        if (decoded && decoded.items) {
            appliedSharePayloadRef.current = true
            setItems(decoded.items)
            setTitle(decoded.name || 'Shared Mood Board')
            if (decoded.theme) setTags([decoded.theme])
        }
    }
  }, [])

  useEffect(() => {
    if (appliedSharePayloadRef.current) return
    if (!Array.isArray(stableInitialItems) || stableInitialItems.length === 0) return
    if (itemsSignature === initialItemsSignature) return
    setItems(stableInitialItems)
  }, [initialItemsSignature, itemsSignature, stableInitialItems])

  // Helper to load a collection
  const handleLoadCollection = (collection) => {
    setItems(collection.items || [])
    setTitle(collection.name || 'Untitled')
    setSubtitle(`Created on ${new Date(collection.createdAt).toLocaleDateString()}`)
    if (collection.theme) setTags([collection.theme])
    setActiveTab('editor')
  }

  // Helper to load a popular board
  const handleLoadPopular = (board) => {
    setItems(board.items)
    setTitle(board.title)
    setSubtitle(board.subtitle)
    setTags(board.tags)
    setLayout(board.layout || LAYOUTS.GRID_3X3)
    setActiveTab('editor')
  }

  // Add tag
  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      if (tags.length < 5) {
        setTags([...tags, tagInput.trim()])
        setTagInput('')
      }
    }
  }

  // Remove tag
  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  // Sort items based on layout
  const displayItems = useMemo(() => {
    let sorted = [...items]
    if (layout === LAYOUTS.TIMELINE) {
      sorted.sort((a, b) => new Date(a.date) - new Date(b.date))
    } else if (layout === LAYOUTS.GRADIENT) {
        // Simple mock sort by "hue" (really just random for now as we need analysis data)
        // In a real app, we'd use the analysis data. 
        // Let's try to sort by title length as a deterministic shuffle if we don't have color data easily available synchronously
        // Or better, keep original order if no analysis.
        // If we want to be fancy, we could fetch analysis, but that's async.
        // Let's leave as is for now, maybe simple reverse for variety.
    }
    return sorted.slice(0, 12) // Limit to 12
  }, [items, layout])

  // Generate Share URL
  const generateShareLink = () => {
    if (items.length === 0) return
    const payload = {
      id: `mb-${Date.now()}`,
      version: 1,
      name: title,
      theme: tags[0] || 'Mood',
      createdAt: new Date().toISOString(),
      items: items.map((i) => ({
        title: i.title,
        date: i.date,
        url: i.url,
        hdurl: i.hdurl,
        media_type: i.media_type,
        copyright: i.copyright,
      })),
    }

    const encoded = encodeCollectionPayload(payload)
    const withPayload = encoded.length <= 12000 ? encoded : null
    const baseUrl = window.location.href

    const meta = buildCollectionShareMeta({
      name: title,
      theme: tags[0] || 'Mood',
      items,
      baseUrl,
    })

    const url = buildShareUrlWithMeta({
      baseUrl,
      meta,
      params: { view: 'moodboard', payload: withPayload },
    })

    setShareUrl(url)
    setShareNotice(withPayload ? 'Share link includes payload.' : 'Share link is too large to embed payload.')
    copyToClipboard(url)
  }
  
  // Download Image
  const handleDownload = async () => {
    if (!boardRef.current) return
    setIsExporting(true)
    try {
        await downloadMoodBoardAsPng({
            element: boardRef.current,
            filename: `${title.replace(/\s+/g, '_')}_MoodBoard.png`,
            title,
            items,
        })
    } catch (err) {
        console.error("Failed to generate image", err)
    } finally {
        setIsExporting(false)
    }
  }

  const shareLinks = useMemo(() => {
    if (!shareUrl) return null
    return getSocialShareLinks({
      url: shareUrl,
      title,
      description: subtitle,
      image: getApodImageUrl(items[0], 'thumbnail') ?? getApodImageUrl(items[0], 'original') ?? '',
    })
  }, [shareUrl, title, subtitle, items])

  const copyEmbedCode = async () => {
    const url = shareUrl || buildShareUrlWithMeta({ params: { view: 'moodboard' } })
    const attribution = 'Credits: NASA/APOD; additional rights retained by original copyright holders'
    const code = generateEmbedCode({ url, title, attribution })
    await copyToClipboard(code)
    setShareNotice('Embed code copied.')
  }

  const downloadQr = async () => {
    if (!shareUrl) generateShareLink()
    const finalUrl = shareUrl || window.location.href
    const safeName = `${title.replace(/\s+/g, '_')}_QR.png`
    await downloadQrCodePng({ text: finalUrl, filename: safeName })
    setShareNotice('QR code downloaded.')
  }

  // Renderers
  const renderGrid = (cols) => (
    <div className={`grid gap-4 ${cols === 3 ? 'grid-cols-3' : cols === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {displayItems.map((item, i) => (
        <div key={i} className="aspect-square overflow-hidden rounded-lg bg-gray-900 shadow-lg">
          <img src={getApodImageUrl(item)} alt={item.title} className="h-full w-full object-cover transition-transform hover:scale-105" />
        </div>
      ))}
    </div>
  )

  const renderCollage = () => (
    <div className="relative h-[600px] w-full overflow-hidden rounded-xl bg-gray-900/50 p-4">
      {displayItems.map((item, i) => {
        const rotation = (i % 2 === 0 ? 1 : -1) * ((i * 5) % 15)
        const left = (i % 3) * 30 + (i % 2) * 10
        const top = Math.floor(i / 3) * 25 + (i % 4) * 5
        const zIndex = i
        return (
            <div 
                key={i} 
                className="absolute w-48 shadow-xl transition-transform hover:z-50 hover:scale-110"
                style={{ 
                    left: `${left}%`, 
                    top: `${top}%`, 
                    transform: `rotate(${rotation}deg)`,
                    zIndex 
                }}
            >
                <div className="bg-white p-2 pb-8 shadow-sm transform transition-transform">
                    <img src={getApodImageUrl(item)} alt={item.title} className="h-32 w-full object-cover bg-gray-200" />
                    <p className="mt-2 text-center text-[10px] text-gray-800 font-serif leading-tight">{item.title}</p>
                </div>
            </div>
        )
      })}
    </div>
  )

  const renderTimeline = () => (
    <div className="flex flex-col gap-8 relative p-8">
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/20 transform -translate-x-1/2"></div>
        {displayItems.map((item, i) => (
            <div key={i} className={`flex items-center gap-8 ${i % 2 === 0 ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className="w-1/2 flex justify-end">
                    <div className={`${i % 2 === 0 ? 'text-right' : 'text-left'}`}>
                        <span className="text-2xl font-bold text-space-aurora">{item.date}</span>
                        <h3 className="text-lg text-white font-medium">{item.title}</h3>
                    </div>
                </div>
                <div className="relative z-10 w-4 h-4 rounded-full bg-space-aurora border-4 border-space-void shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                <div className="w-1/2">
                    <img src={getApodImageUrl(item)} alt={item.title} className="w-48 h-32 object-cover rounded-lg border border-white/10 shadow-lg" />
                </div>
            </div>
        ))}
    </div>
  )

  const renderContent = () => {
    switch(layout) {
        case LAYOUTS.GRID_2X3: return renderGrid(2)
        case LAYOUTS.GRID_3X3: return renderGrid(3)
        case LAYOUTS.GRID_4X3: return renderGrid(4)
        case LAYOUTS.COLLAGE: return renderCollage()
        case LAYOUTS.TIMELINE: return renderTimeline()
        case LAYOUTS.GRADIENT: return renderGrid(4) // Fallback for now
        default: return renderGrid(3)
    }
  }

  if (activeTab === 'gallery') {
    return (
        <div className="max-w-7xl mx-auto p-6">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-bold text-space-stardust">Public Gallery</h2>
                <button 
                    onClick={() => setActiveTab('editor')}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-white text-sm font-medium transition-colors"
                >
                    Back to Creator
                </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {POPULAR_BOARDS.map(board => (
                    <div key={board.id} className="bg-space-void/60 border border-white/10 rounded-2xl overflow-hidden hover:border-space-aurora/50 transition-colors group cursor-pointer" onClick={() => handleLoadPopular(board)}>
                        <div className="h-48 overflow-hidden relative">
                             <img src={board.items[0]?.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                             <div className="absolute inset-0 bg-gradient-to-t from-space-void to-transparent"></div>
                             <div className="absolute bottom-4 left-4">
                                <h3 className="text-xl font-bold text-white">{board.title}</h3>
                                <p className="text-sm text-gray-300">{board.items.length} items</p>
                             </div>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-gray-400 mb-3">{board.subtitle}</p>
                            <div className="flex flex-wrap gap-2">
                                {board.tags.map(tag => (
                                    <span key={tag} className="text-xs px-2 py-1 rounded-full bg-white/5 text-gray-300 border border-white/5">{tag}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header / Controls */}
      <div className="flex flex-col lg:flex-row gap-6 bg-space-void/40 p-6 rounded-3xl border border-white/10 backdrop-blur-md">
        <div className="flex-1 space-y-4">
            <div className="flex justify-between items-start">
                <h2 className="text-2xl font-bold text-space-stardust">Mood Board Creator</h2>
                <button 
                    onClick={() => setActiveTab('gallery')}
                    className="lg:hidden text-sm text-space-aurora hover:underline"
                >
                    Browse Gallery
                </button>
            </div>
            
            <div className="space-y-2">
                <label className="text-xs font-medium tracking-widest text-slate-200/70">TITLE & SUBTITLE</label>
                <input 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-space-aurora/50"
                    placeholder="Board Title"
                />
                <input 
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-space-aurora/50"
                    placeholder="Subtitle or description..."
                />
            </div>

            <div>
                <label className="text-xs font-medium tracking-widest text-slate-200/70">LAYOUT</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {Object.values(LAYOUTS).map(l => (
                        <button
                            key={l}
                            onClick={() => setLayout(l)}
                            className={`px-3 py-2 text-xs rounded-lg border transition-all ${layout === l ? 'bg-space-aurora/20 border-space-aurora text-white' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'}`}
                        >
                            {LAYOUT_LABELS[l]}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className="text-xs font-medium tracking-widest text-slate-200/70">TAGS (Max 5)</label>
                <div className="flex flex-wrap gap-2 mt-2 mb-2">
                    {tags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 bg-space-aurora/10 text-space-aurora px-2 py-1 rounded-full text-xs border border-space-aurora/20">
                            {tag}
                            <button onClick={() => handleRemoveTag(tag)} className="hover:text-white">×</button>
                        </span>
                    ))}
                </div>
                <input 
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-space-aurora/50"
                    placeholder="Type tag and press Enter"
                    disabled={tags.length >= 5}
                />
            </div>
        </div>

        <div className="flex flex-col gap-4 min-w-[200px]">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h3 className="text-sm font-semibold text-white mb-2">Actions</h3>
                <div className="space-y-2">
                    <button 
                        onClick={handleDownload}
                        disabled={items.length === 0}
                        className="w-full py-2 bg-space-aurora/20 hover:bg-space-aurora/30 text-space-aurora rounded-lg text-sm font-medium transition-colors border border-space-aurora/20"
                    >
                        {isExporting ? 'Exporting...' : 'Download PNG'}
                    </button>
                    <button
                      onClick={generateShareLink}
                      disabled={items.length === 0}
                      className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors border border-white/10"
                    >
                      Copy Share Link
                    </button>
                    <button
                      onClick={copyEmbedCode}
                      disabled={items.length === 0}
                      className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors border border-white/10"
                    >
                      Copy Embed Code
                    </button>
                    <button
                      onClick={downloadQr}
                      disabled={items.length === 0}
                      className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors border border-white/10"
                    >
                      Download QR Code
                    </button>
                    <button 
                        onClick={() => setActiveTab('gallery')}
                        className="w-full py-2 bg-transparent hover:bg-white/5 text-gray-400 rounded-lg text-sm font-medium transition-colors"
                    >
                        View Gallery
                    </button>
                </div>
                {shareNotice ? <p className="mt-3 text-xs text-gray-400">{shareNotice}</p> : null}
                {shareLinks ? (
                  <div className="mt-3 flex gap-2">
                    <a
                      href={shareLinks.twitter}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Twitter
                    </a>
                    <a
                      href={shareLinks.pinterest}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Pinterest
                    </a>
                    <a
                      href={shareLinks.reddit}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Reddit
                    </a>
                  </div>
                ) : null}
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex-1 overflow-y-auto max-h-[200px]">
                <h3 className="text-sm font-semibold text-white mb-2">Saved Collections</h3>
                {savedCollections.length === 0 ? (
                    <p className="text-xs text-gray-500">No saved collections found.</p>
                ) : (
                    <ul className="space-y-1">
                        {savedCollections.map(c => (
                            <li key={c.id}>
                                <button onClick={() => handleLoadCollection(c)} className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10 rounded truncate">
                                    {c.name || 'Untitled'}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
      </div>

      {/* Board Preview */}
      <div className="bg-space-void border border-white/10 rounded-3xl p-8 shadow-2xl overflow-x-auto">
        <div ref={boardRef} className="bg-space-void min-w-[800px] p-8 rounded-xl" style={{ backgroundImage: 'radial-gradient(circle at center, #1e293b 0%, #0b1220 100%)' }}>
            {/* Header Overlay */}
            <div className="text-center mb-8">
                <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-space-stardust to-space-aurora mb-2 font-serif tracking-tight">
                    {title}
                </h1>
                <p className="text-xl text-gray-400 font-light tracking-wide">{subtitle}</p>
                <div className="flex justify-center gap-3 mt-4">
                    {tags.map(tag => (
                        <span key={tag} className="text-xs uppercase tracking-widest text-space-aurora border-b border-space-aurora/30 pb-0.5">{tag}</span>
                    ))}
                </div>
            </div>

            {/* Layout Content */}
            {items.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                    <p className="text-gray-400">No images selected</p>
                    <p className="text-sm text-gray-600 mt-2">Load a collection or popular board to get started</p>
                </div>
            ) : (
                renderContent()
            )}

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-white/5 flex justify-between items-center text-white/30">
                <span className="text-xs tracking-widest">APOD MOOD GALLERY • NASA/APOD</span>
                <span className="text-xs">© original copyright holders</span>
            </div>
        </div>
      </div>
    </div>
  )
}

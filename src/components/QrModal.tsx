import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { DiveDay } from '../types'
import { encodeDayForUrl } from '../lib/storage'

interface Props {
  day: DiveDay
  baseUrl: string
  onClose: () => void
}

export function QrModal({ day, baseUrl, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    const encoded = encodeDayForUrl(day)
    const url = `${baseUrl}?d=${encoded}`

    if (encoded.length > 1400) {
      setWarn(`Plan is large (${encoded.length} chars encoded) — QR may be hard to scan. Use JSON export instead.`)
    }

    QRCode.toCanvas(canvasRef.current!, url, {
      width: 280,
      margin: 2,
      color: { dark: '#111111', light: '#ffffff' },
      errorCorrectionLevel: 'L',
    })
  }, [day, baseUrl])

  return (
    <div className="qr-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={e => e.stopPropagation()}>
        <div className="qr-header">
          <strong>{day.title || 'Dive day'}</strong>
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <canvas ref={canvasRef} />
        <p className="subtitle" style={{ textAlign: 'center', marginTop: 10 }}>
          Scan with your phone camera to open and import this plan.
        </p>
        {warn && (
          <div className="alert alert-short" style={{ marginTop: 8, fontSize: 11 }}>{warn}</div>
        )}
      </div>
    </div>
  )
}

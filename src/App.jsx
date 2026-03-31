import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import './App.css'

const GAME_WIDTH = 960
const GAME_HEIGHT = 540
const GAME_DURATION = 45

const animals = ['🦌', '🐗', '🦊', '🐇', '🦝']

function randomAnimal() {
  return animals[Math.floor(Math.random() * animals.length)]
}

function spawnAnimal() {
  const size = 56 + Math.random() * 42
  return {
    id: crypto.randomUUID(),
    x: 120 + Math.random() * (GAME_WIDTH - 240),
    y: 120 + Math.random() * (GAME_HEIGHT - 220),
    size,
    vx: (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 1.7),
    vy: (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.4),
    emoji: randomAnimal(),
  }
}

// 싱글톤 AudioContext — 사용자 제스처(startGame)에서 초기화해야 브라우저 차단 안 됨
let sharedAudioCtx = null

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return null
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContextClass()
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume()
  }
  return sharedAudioCtx
}

function playShotSound() {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const now = ctx.currentTime

  // 노이즈 버스트 (총소리 핵심)
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate)
  const output = noiseBuffer.getChannelData(0)
  for (let i = 0; i < output.length; i += 1) {
    output[i] = (Math.random() * 2 - 1) * (1 - i / output.length) ** 0.6
  }

  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer
  const bandpass = ctx.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.value = 1000
  bandpass.Q.value = 0.8
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.35, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

  noise.connect(bandpass)
  bandpass.connect(noiseGain)
  noiseGain.connect(ctx.destination)

  // 저음 펀치 (타격감)
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(220, now)
  osc.frequency.exponentialRampToValueAtTime(50, now + 0.15)
  const oscGain = ctx.createGain()
  oscGain.gain.setValueAtTime(0.15, now)
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)

  osc.connect(oscGain)
  oscGain.connect(ctx.destination)

  // 고음 크랙 (총 특유의 찰칵)
  const crack = ctx.createOscillator()
  crack.type = 'square'
  crack.frequency.setValueAtTime(800, now)
  crack.frequency.exponentialRampToValueAtTime(200, now + 0.06)
  const crackGain = ctx.createGain()
  crackGain.gain.setValueAtTime(0.1, now)
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)

  crack.connect(crackGain)
  crackGain.connect(ctx.destination)

  noise.start(now)
  noise.stop(now + 0.18)
  osc.start(now)
  osc.stop(now + 0.15)
  crack.start(now)
  crack.stop(now + 0.06)
}

function App() {
  const videoRef = useRef(null)
  const landmarkerRef = useRef(null)
  const animationRef = useRef(null)
  const gameLoopRef = useRef(null)
  const crosshairRef = useRef({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, visible: false })
  const [cameraReady, setCameraReady] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION)
  const [running, setRunning] = useState(false)
  const [crosshairPos, setCrosshairPos] = useState({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, visible: false })
  const [animalsState, setAnimalsState] = useState(() => Array.from({ length: 4 }, spawnAnimal))
  const [hitBursts, setHitBursts] = useState([])
  const [statusText, setStatusText] = useState('카메라를 켜고 손 검지를 조준점처럼 움직여봐.')

  useEffect(() => {
    let mounted = true
    const videoElement = videoRef.current

    async function setupCameraAndHands() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (!mounted || !videoElement) return
        videoElement.srcObject = stream
        await videoElement.play()

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        )

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          numHands: 1,
          runningMode: 'VIDEO',
        })

        landmarkerRef.current = handLandmarker
        setCameraReady(true)
        setStatusText('좋아. 손 검지 끝이 조준점이야. 동물 위에 올려서 사냥해.')
      } catch (error) {
        setPermissionError(error.message || '카메라를 사용할 수 없어.')
      }
    }

    setupCameraAndHands()

    return () => {
      mounted = false
      cancelAnimationFrame(animationRef.current)
      clearInterval(gameLoopRef.current)
      landmarkerRef.current?.close?.()
      const stream = videoElement?.srcObject
      stream?.getTracks?.().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!cameraReady || !videoRef.current || !landmarkerRef.current) return

    const tick = () => {
      const video = videoRef.current
      const results = landmarkerRef.current.detectForVideo(video, performance.now())
      const landmarks = results?.landmarks?.[0]

      if (landmarks?.[8]) {
        const indexTip = landmarks[8]
        const x = (1 - indexTip.x) * GAME_WIDTH
        const y = indexTip.y * GAME_HEIGHT
        crosshairRef.current = { x, y, visible: true }
        setCrosshairPos({ x, y, visible: true })
      } else {
        crosshairRef.current = { ...crosshairRef.current, visible: false }
        setCrosshairPos((current) => ({ ...current, visible: false }))
      }

      animationRef.current = requestAnimationFrame(tick)
    }

    animationRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationRef.current)
  }, [cameraReady])

  // 1초마다 타이머 감소 (게임 루프와 분리)
  useEffect(() => {
    if (!running) return undefined

    const timerId = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          setRunning(false)
          setStatusText('사냥 종료! 다시 시작해서 최고 점수를 노려봐.')
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => clearInterval(timerId)
  }, [running])

  // 동물 이동 + 충돌 판정 (crosshairRef 사용으로 재생성 방지)
  useEffect(() => {
    if (!running) return undefined

    gameLoopRef.current = window.setInterval(() => {
      const hits = []
      const ch = crosshairRef.current

      setAnimalsState((currentAnimals) =>
        currentAnimals.map((animal) => {
          let nextX = animal.x + animal.vx * 8
          let nextY = animal.y + animal.vy * 8
          let nextVx = animal.vx
          let nextVy = animal.vy

          if (nextX < 40 || nextX > GAME_WIDTH - 100) nextVx *= -1
          if (nextY < 50 || nextY > GAME_HEIGHT - 110) nextVy *= -1

          nextX = Math.min(Math.max(nextX, 40), GAME_WIDTH - 100)
          nextY = Math.min(Math.max(nextY, 50), GAME_HEIGHT - 110)

          const movedAnimal = { ...animal, x: nextX, y: nextY, vx: nextVx, vy: nextVy }

          if (ch.visible) {
            const centerX = movedAnimal.x + movedAnimal.size / 2
            const centerY = movedAnimal.y + movedAnimal.size / 2
            const distance = Math.hypot(ch.x - centerX, ch.y - centerY)
            const radius = movedAnimal.size * 0.42

            if (distance < radius) {
              hits.push({
                id: crypto.randomUUID(),
                x: centerX,
                y: centerY,
                emoji: movedAnimal.emoji,
              })
              return spawnAnimal()
            }
          }

          return movedAnimal
        }),
      )

      if (hits.length > 0) {
        playShotSound()
        setScore((current) => current + hits.length)
        setStatusText(`${hits[0].emoji} 사냥 성공! 탕!`)
        setHitBursts((current) => [...current, ...hits])
        window.setTimeout(() => {
          setHitBursts((current) => current.filter((burst) => !hits.some((hit) => hit.id === burst.id)))
        }, 700)
      }
    }, 220)

    return () => clearInterval(gameLoopRef.current)
  }, [running])

  const accuracyHint = useMemo(() => {
    if (!cameraReady) return '카메라 준비 중'
    if (!crosshairPos.visible) return '손이 화면에 안 잡혔어'
    return '검지 끝으로 동물 위를 천천히 훑어봐'
  }, [cameraReady, crosshairPos.visible])

  const startGame = () => {
    // 사용자 클릭 이벤트 안에서 AudioContext를 초기화해야 브라우저가 허용
    ensureAudioContext()
    setScore(0)
    setTimeLeft(GAME_DURATION)
    setAnimalsState(Array.from({ length: 4 }, spawnAnimal))
    setHitBursts([])
    setRunning(true)
    setStatusText('사냥 시작! 동물에 조준점이 닿으면 탕 하고 사냥돼.')
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <span className="eyebrow">0331 Camera Game</span>
          <h1>Wild Hand Hunt</h1>
          <p className="lead">
            웹캠 또는 휴대폰 카메라를 켜고 손 검지로 조준해 동물을 사냥하는 미니 게임이야.
            검지 끝이 조준점이 되고, 동물 위에 정확히 겹치면 총소리와 함께 사냥 성공 처리돼.
          </p>
        </div>

        <div className="stats-grid">
          <div className="stat-card accent">
            <span>점수</span>
            <strong>{score}</strong>
          </div>
          <div className="stat-card">
            <span>남은 시간</span>
            <strong>{timeLeft}초</strong>
          </div>
          <div className="stat-card">
            <span>상태</span>
            <strong>{accuracyHint}</strong>
          </div>
        </div>
      </section>

      {permissionError ? <div className="notice error">카메라 오류: {permissionError}</div> : null}

      <section className="game-layout">
        <div className="game-panel">
          <div className="stage-frame" style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}>
            <video ref={videoRef} className="camera-layer" playsInline muted />
            <div className="overlay-layer">
              {animalsState.map((animal) => (
                <div
                  key={animal.id}
                  className="animal"
                  style={{ left: animal.x, top: animal.y, width: animal.size, height: animal.size }}
                >
                  <span>{animal.emoji}</span>
                </div>
              ))}
              {hitBursts.map((burst) => (
                <div key={burst.id} className="hit-burst" style={{ left: burst.x, top: burst.y }}>
                  <span className="bubble-ring ring-1" />
                  <span className="bubble-ring ring-2" />
                  <span className="bubble-ring ring-3" />
                  <span className="bubble-pop">{burst.emoji}</span>
                  <span className="flash">💥</span>
                  <span className="shot-text">탕!</span>
                  {[...Array(8)].map((_, i) => (
                    <span key={i} className="particle" style={{ '--angle': `${i * 45}deg` }} />
                  ))}
                </div>
              ))}
              {crosshairPos.visible ? (
                <div className="crosshair" style={{ left: crosshairPos.x - 28, top: crosshairPos.y - 28 }}>
                  <div className="ring" />
                  <div className="dot" />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="side-panel">
          <div className="info-card">
            <h2>플레이 방법</h2>
            <ul>
              <li>브라우저 카메라 권한을 허용해.</li>
              <li>한 손만 화면에 올리고 검지를 펴.</li>
              <li>검지 끝이 조준점이 돼.</li>
              <li>동물 위에 조준점이 닿으면 총소리와 함께 명중!</li>
            </ul>
          </div>

          <div className="info-card">
            <h2>팁</h2>
            <ul>
              <li>배경이 단순할수록 손 인식이 잘 돼.</li>
              <li>손을 너무 카메라 가까이에 대지 마.</li>
              <li>휴대폰 카메라로도 브라우저에서 실행 가능해.</li>
            </ul>
          </div>

          <button className="start-button" type="button" onClick={startGame} disabled={!cameraReady}>
            {running ? '다시 시작' : '사냥 시작'}
          </button>

          <p className="status-copy">{statusText}</p>
        </aside>
      </section>
    </main>
  )
}

export default App

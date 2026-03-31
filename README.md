# Wild Hand Hunt

웹캠 또는 휴대폰 카메라를 사용해 손으로 조준하는 미니 사냥 게임입니다. MediaPipe 손 인식을 사용해 검지 끝을 조준점처럼 추적하고, 동물과 겹치면 명중 처리됩니다.

## 기능

- 브라우저 카메라 사용
- MediaPipe 기반 손 인식
- 손 검지 끝 조준점 추적
- 이동하는 동물 명중 판정
- 45초 타임어택
- 점수 집계
- 모바일 브라우저 실행 가능

## 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
npm run preview
```

## 플레이 방법

1. 카메라 권한을 허용합니다.
2. 한 손만 화면에 올립니다.
3. 검지 끝이 조준점이 됩니다.
4. 동물에 조준점이 닿으면 사냥 성공입니다.
5. 45초 안에 최대한 많이 맞히면 됩니다.

## 기술 스택

- React
- Vite
- MediaPipe Tasks Vision

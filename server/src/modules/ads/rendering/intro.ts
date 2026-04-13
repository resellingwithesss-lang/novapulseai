import { spawn } from "child_process"

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let stderr = ""

    p.stderr.on("data", d => {
      stderr += d.toString()
    })

    p.on("close", c => {
      if (c === 0) resolve()
      else reject(new Error(stderr))
    })
  })
}

function pickStyle() {
  return Math.floor(Math.random() * 4)
}

export async function createNovaPulseIntro(output: string) {
  const style = pickStyle()
  let filter = ""

  switch (style) {
    case 0:
      filter = [
        "drawbox=x=0:y=0:w=iw:h=ih:color=#05070f@1:t=fill",
        "drawtext=text='NovaPulseAI':fontcolor=white:fontsize=136:x=(w-text_w)/2:y=(h-text_h)/2-60",
        "drawtext=text='Turn Content Into Momentum':fontcolor=#d8b4fe:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2+100",
        "fade=t=in:st=0:d=0.5",
        "fade=t=out:st=2.7:d=0.5"
      ].join(",")

      break

    case 1:
      filter = [
        "zoompan=z='min(zoom+0.0015,1.12)':d=100:s=1920x1080",
        "vignette=PI/18",
        "drawtext=text='NovaPulseAI':fontcolor=white:fontsize=142:x=(w-text_w)/2:y=(h-text_h)/2-72",
        "drawtext=text='AI Creator Growth Engine':fontcolor=#c4b5fd:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2+88",
        "fade=t=in:st=0:d=0.6",
        "fade=t=out:st=2.6:d=0.6"
      ].join(":")

      break

    case 2:
      filter = [
        "drawtext=text='NovaPulseAI':fontcolor=white:fontsize=142:x='-text_w+t*640':y=(h-text_h)/2-72",
        "drawtext=text='Create Faster. Scale Harder.':fontcolor=#f0abfc:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2+96",
        "fade=t=in:st=0:d=0.4",
        "fade=t=out:st=2.7:d=0.5"
      ].join(":")

      break

    default:
      filter = [
        "drawbox=x=0:y=0:w=iw:h=ih:color=#05070f@1:t=fill",
        "drawbox=x='mod(t*1200,w)-200':y=0:w=120:h=h:color=#9333ea@0.15:t=fill",
        "drawtext=text='NovaPulseAI':fontcolor=white:fontsize=144:x=(w-text_w)/2:y=(h-text_h)/2-72",
        "drawtext=text='High-Retention Video System':fontcolor=#d8b4fe:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2+94",
        "fade=t=in:st=0:d=0.5",
        "fade=t=out:st=2.7:d=0.5"
      ].join(":")
  }

  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=#05070f:s=1920x1080:d=3.2",
    "-vf", filter,
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-movflags", "+faststart",
    output
  ])
}
import express from 'express'
import multer from 'multer'
import path from 'path'
import sharp from 'sharp'
import fs from 'fs'
import { fileTypeFromBuffer } from 'file-type'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'stream'


const __dirname = dirname(fileURLToPath(import.meta.url))
// FFMPEG
const ffmpegPath = process.env.FFMPEG_PATH || path.join(__dirname, 'bin', 'ffmpeg')
import ffmpeg from "fluent-ffmpeg-7"
ffmpeg.setFfmpegPath(ffmpegPath)

const lang = JSON.parse(fs.readFileSync(path.join(__dirname, 'lang.json'), 'utf8'))

function getLanguage(req) {
    const paramLang = req.query.lang || 'id'
    return lang[paramLang] || lang['id']
}

const app = express()
const quality = 70
const PORT = process.env.PORT || 8080
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

app.use(express.static(path.join(__dirname)))
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

app.get('/', async (req, res) => {
    const langData = getLanguage(req)
    if (!req.query.url) {
        return res.render('index', { lang: langData, currentLang: req.query.lang || 'id' })
    }
    const paramUrl = req.query.url
    await stikerin(null, paramUrl)
        .then(data => {
            res.status(200)
            res.set('Content-Type', 'image/webp')
            res.send(data)
        })
        .catch(error => {
            console.error(error)
            res.status(500).send('Internal Server Error')
        })
})

app.get('/docs', async (req, res) => {
    const langData = getLanguage(req)
    const baseUrl = `${req.protocol}://${req.get('host')}`
    res.render('docs', { baseUrl, lang: langData, currentLang: req.query.lang || 'id' })
})

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("Tidak ada foto yang terupload.")
        const fileBuffer = req.file.buffer
        await stikerin(fileBuffer, null)
            .then(data => {
                res.status(200)
                res.set('Content-Type', 'image/webp')
                res.send(data)
            })
            .catch(err => {
                res.status(500).send('Internal Server Error')
            })
    } catch (error) {
        console.error(error)
        res.status(500).send('Internal Server Error')
    }
})



function stikerin(inputFile, url) {
    return new Promise(async (resolve, reject) => {
        try {
            if (url) {
                let res = await fetch(url)
                if (res.status !== 200) return reject(res.status)
                inputFile = await res.arrayBuffer()
            }
            const type = await fileTypeFromBuffer(inputFile) || {
                mime: 'application/octet-stream',
                ext: 'bin'
            }
            if (/video/i.test(type.mime)) {
                const iterable = Readable.from(Buffer.from(inputFile))
                const out = path.join(path.join(__dirname, `tmp/${+ new Date()}.webp`))
                fluent_ffmpeg(iterable)
                    .outputOptions([
                        `-vcodec`, `libwebp`, `-vf`,
                        `scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse`
                    ])
                    .on('end', async () => {
                        let data = await fs.promises.readFile(out)
                        resolve(data)
                        return fs.promises.unlink(out)
                    })
                    .on('error', (err) => {
                        console.error(err)
                        return reject(inputFile)
                    })
                    .save(out)
            } else if (/image/i.test(type.mime)) {
                let { width, height } = await sharp(inputFile).metadata()
                let size = Math.max(width, height)
                await sharp(inputFile)
                    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp({ quality })
                    .toBuffer()
                    .then(data => {
                        return resolve(data)
                    })
                    .catch(err => {
                        console.error(err)
                        return reject(err)
                    })
            }
        } catch (err) {
            console.error(err)
            reject(err)
        }
    })
}

app.listen(PORT, () => {
    console.log(`Server berjalan pada port ${PORT}`)
})
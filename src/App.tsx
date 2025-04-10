import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import { v4 as uuidv4 } from 'uuid';
import download from 'downloadjs';
import fileUpload from './assets/file_upload.png';
import downloading from './assets/downloading.svg';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faSpinner, faClipboardCheck, faCopy } from '@fortawesome/free-solid-svg-icons'

// Define types for WebSocket messages
type CreateMessage = {
    type: 'create';
    roomId: string;
};

type JoinMessage = {
    type: 'join';
    roomId: string;
    clientId?: string;
};

type SignalMessage = {
    type: 'signal';
    peerId: string;
    signal: SimplePeer.SignalData;
};

type JoinedResponseMessage = {
    type: 'joined';
    roomId: string;
    clientId: string;
    peers: string[];
};

type PeerJoinedMessage = {
    type: 'peer-joined';
    peerId: string;
};

type PeerLeftMessage = {
    type: 'peer-left';
    peerId: string;
};

type SignalResponseMessage = {
    type: 'signal';
    peerId: string;
    signal: SimplePeer.SignalData;
};

type RoomNonexistentMessage = {
    type: 'room-nonexistent';
    roomId: string;
};

type WebSocketMessage =
    | JoinMessage
    | SignalMessage
    | JoinedResponseMessage
    | PeerJoinedMessage
    | PeerLeftMessage
    | RoomNonexistentMessage
    | SignalResponseMessage;

const SERVER_HOST = import.meta.env.MODE == "development" ? "localhost:5000" : "airbridge-signaling-server.onrender.com"

export default () => {
    const [filesSelected, setFilesSelected] = useState(false);
    const [receiving, setReceiving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [copied, setCopied] = useState(false);
    const [downloadPercentage, setDownloadPercentage] = useState("0");
    const [fileName, setFileName] = useState("");
    const [downloadStatuses, setDownloadStatuses] = useState<{ [fileName: string]: boolean } | null>({});

    const navigate = useNavigate()
    const location = useLocation()

    const filesRef = useRef<File[]>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());

    const connectToRoom = (roomId: string, create = false, init = false): void => {
        const socket = new WebSocket(`wss://${SERVER_HOST}`);
        socketRef.current = socket;

        socket.onopen = () => {
            const message: JoinMessage | CreateMessage = create ? { type: 'create', roomId } : { type: 'join', roomId }
            socket.send(JSON.stringify(message));
        };

        socket.onmessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data) as WebSocketMessage;

            switch (data.type) {
                case 'joined': {
                    if (init) {
                        if (socketRef.current) {
                            socketRef.current.close();
                        }
                        return
                    }

                    const joinedData = data as JoinedResponseMessage;
                    joinedData.peers.forEach(peerId => {
                        createPeer(peerId, false);
                    });

                    break;
                }

                case 'peer-joined': {
                    if (init) return;
                    const peerJoinedData = data as PeerJoinedMessage;
                    createPeer(peerJoinedData.peerId, true);

                    break;
                }

                case 'peer-left': {
                    if (init) return;
                    const peerLeftData = data as PeerLeftMessage;
                    if (peersRef.current.has(peerLeftData.peerId)) {
                        peersRef.current.get(peerLeftData.peerId)?.destroy();
                        peersRef.current.delete(peerLeftData.peerId);
                    }
                    break;
                }

                case 'room-nonexistent': {
                    navigate("/404", { replace: true })
                    break;
                }

                case 'signal': {
                    if (init) return;
                    const signalData = data as SignalResponseMessage;
                    const peer = peersRef.current.get(signalData.peerId);
                    if (peer) {
                        peer.signal(signalData.signal);
                    }
                    break;
                }
            }
        };

        socket.onclose = () => {
        };

        socket.onerror = (error: Event) => {
            console.error('WebSocket error:', error);
            navigate("/404", { replace: true })
        };
    };

    const createPeer = (peerId: string, initiator: boolean): SimplePeer.Instance => {
        const fileChunks: BlobPart[] = [];
        let fileNames: string[] = []
        let localDownloadStatuses: { [fileName: string]: boolean } = {}
        let fileName = ""
        let fileSize = 0
        let downloadProgress = 0

        const peer = new SimplePeer({
            initiator,
            trickle: false,
            config: {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            }
        });

        peer.on('signal', (signal: SimplePeer.SignalData) => {
            const signalMessage: SignalMessage = {
                type: 'signal',
                peerId,
                signal
            };
            socketRef.current?.send(JSON.stringify(signalMessage));
        });

        peer.on('connect', async () => {
            if (filesRef.current === null) return;

            peersRef.current.forEach((peer) => {
                peer.send(`//init//${JSON.stringify(filesRef.current?.map((file) => file.name))}`);
            });

            for (let fileRef of filesRef.current) {
                let buffer = await fileRef.arrayBuffer()

                peersRef.current.forEach((peer) => {
                    peer.send(`//start//${JSON.stringify({
                        name: fileRef.name,
                        size: buffer.byteLength
                    })}`);
                });

                const chunkSize = 16 * 1024;

                while (buffer.byteLength) {
                    const chunk = buffer.slice(0, chunkSize);
                    buffer = buffer.slice(chunkSize, buffer.byteLength);

                    peersRef.current.forEach((peer) => {
                        peer.send(chunk);
                    });
                }

                peersRef.current.forEach((peer) => {
                    peer.send(`//end//`);
                });
            }

            peersRef.current.forEach((peer) => {
                peer.send(`//finish//`);
            });

        });

        peer.on('data', (data: Uint8Array) => {
            if (data.toString().includes("//init//")) {
                const json = JSON.parse(data.toString().replace("//init//", ""))

                fileNames = json

                localDownloadStatuses = fileNames.reduce((a, b) => ({ ...a, [b]: false }), {})
                setDownloadStatuses(localDownloadStatuses)

                return
            }

            if (data.toString().includes("//finish//")) {
                setDownloadStatuses(null)
                setTimeout(() => navigate("/"), 5000)

                return
            }


            if (data.toString().includes("//start//")) {
                downloadProgress = 0

                const json = JSON.parse(data.toString().replace("//start//", ""))
                fileName = json.name
                fileSize = parseInt(json.size, 0)
                setFileName(fileName)
                setDownloadPercentage("0")

                return
            }

            if (data.toString().includes("//end//")) {
                const file = new Blob(fileChunks);

                setDownloadPercentage("100")

                localDownloadStatuses = { ...localDownloadStatuses, [fileName]: true }
                setDownloadStatuses(localDownloadStatuses)

                download(file, fileName)
                return
            }

            fileChunks.push(data);
            downloadProgress += data.length
            setDownloadPercentage(`${Math.ceil(downloadProgress / fileSize * 100)}`)
        });

        peer.on('close', () => {
            peersRef.current.delete(peerId);
        });

        peer.on('error', (err: Error) => {
            console.error(`Peer connection error with ${peerId}:`, err);
            navigate("/404", { replace: true })
        });

        peersRef.current.set(peerId, peer);
        return peer;
    };


    const setFilesRef = (files: File[]) => {
        const roomId = uuidv4().slice(0, 8);

        filesRef.current = files;
        setFilesSelected(true)

        navigate(`/${roomId}`, { replace: true })
        connectToRoom(roomId, true);
    }

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();

        setDragging(false);
        setFilesRef([...e.dataTransfer.files])
    };

    useEffect(() => {
        if (location.pathname === "/") return;
        let roomId = location.pathname.slice(1)
        if (roomId.length != 8) {
            navigate("/404", { replace: true })
            return;
        }

        connectToRoom(roomId, false, true);

        return () => {
            if (socketRef.current) {
                socketRef.current.close();
            }

            peersRef.current.forEach(peer => {
                if (peer) peer.destroy();
            });
        };
    }, [])

    return (
        <div className="p-8 bg-gray-900 min-h-screen w-screen flex flex-col items-center">
            <h1 className="text-4xl text-gray-100 font-bold mt-8">AirBridge</h1>
            <p className="text-sm text-gray-500 mt-2 m-0 p-0 text-center">Instant, unlimited file sharing — no size limits, no bandwidth caps.</p>

            {!filesSelected && location.pathname.slice(1).length == 8
                ? <>
                    <div className={`m-0 pt-16 px-0 md:px-16 relative h-100 w-full max-w-250 flex flex-col justify-center items-center`}>
                        <div className={`${receiving ? "border-slate-700 h-100 w-full" : "hover:border-blue-300 border-blue-500 h-16 mb-50"} transition-all bg-slate-900 rounded-2xl border-2 relative overflow-hidden shadow-[0px_0px_20px_0px_rgba(30,41,59,0.3)]`}>
                            {receiving ? <img className="absolute top-0 left-0 right-0 bottom-0 w-full h-full z-10" src={downloading} /> : null}
                            <div className="z-50 relative w-full h-full flex flex-col justify-center items-center">
                                {!receiving
                                    ? <button
                                        className="font-bold py-4 px-8 text-lg"
                                        onClick={() => {
                                            connectToRoom(location.pathname.slice(1))
                                            setReceiving(true)
                                            // setFileName("tesasdfasdfasdfasdfasdfasttesasdfasdfasdfasdfasdfast.ext")
                                            // setDownloadPercentage("70")
                                            // setDownloadStatuses({ "tesasdfasdfasdfasdfasdfasttesasdfasdfasdfasdfasdfast.ext": false, "tesasdfasdfasdfasdfasdfasttesasdfasdfasdfasdfasdfast.file": true })
                                        }}
                                    >
                                        Ready to Download
                                    </button>
                                    : <>
                                        {
                                            downloadStatuses === null
                                                ? null
                                                : <>
                                                    <div className="w-1/2 h-1 shadow-[0px_0px_20px_0px_rgba(59,130,246,1)] bg-slate-300"><div className={`w-[${downloadPercentage}%] h-1 shadow-[0px_0px_20px_0px_rgba(59,130,246,1)] bg-blue-500`}></div></div>
                                                    <p className="mb-4 mt-3 text-slate-400">{downloadPercentage}%</p>
                                                </>
                                        }
                                        <p className="text-2xl font-bold">{downloadStatuses === null ? "Download Complete!" : "Downloading..."}</p>
                                        <p className="mt-1 text-md font-bold text-slate-300 overflow-hidden max-w-full text-ellipsis px-6">{downloadStatuses === null ? "" : fileName}</p>
                                    </>
                                }
                            </div>
                        </div>
                    </div>
                    {downloadStatuses === null ? null :
                        <motion.ul layout layoutId={"list"} className="px-0 md:px-16 pt-2 w-full max-w-250">
                            <AnimatePresence>
                                {Object.entries(downloadStatuses).map((item) => {
                                    return (
                                        <motion.li
                                            initial={{ x: -200, opacity: 0 }}
                                            animate={{ x: 0, opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            key={item[0]}
                                            className="w-full max-w-250"
                                        >
                                            <div className={`shadow-[0px_0px_20px_0px_rgba(30,41,59,0.3)] mt-4 border-slate-700 flex items-center justify-between px-6 py-4 md:px-8 md:py-4 h-full max-w-250 w-full transition-all bg-slate-900 rounded-2xl border-2 relative overflow-hidden`}>
                                                <p className={`${item[1] ? "text-slate-200" : "text-slate-500"} text-md font-bold overflow-hidden text-ellipsis`}>{item[0]}</p>
                                                <div className="relative ml-3">
                                                    <FontAwesomeIcon size={item[1] ? "lg" : undefined} icon={item[1] ? faCheckCircle : faSpinner} className={item[1] ? "text-blue-500" : "text-slate-500 animate-spin"} />
                                                    <div className="absolute overflow-visible h-0 w-0 inset-1/2 shadow-[0px_0px_20px_8px_rgba(59,130,246,1)]" />
                                                </div>
                                            </div>
                                        </motion.li>
                                    );
                                })}
                            </AnimatePresence>
                        </motion.ul>
                    }
                </>
                : <div className={`max-w-250 w-full rounded-2xl border-2 ${filesSelected ? "border-blue-500 shadow-[0px_0px_20px_0px_rgba(59,130,246,0.4)]" : `${dragging ? "border-blue-500 bg-slate-800 shadow-[0px_0px_20px_0px_rgba(59,130,246,0.4)]" : "shadow-[0px_0px_20px_0px_rgba(30,41,59,0.3)] hover:shadow-[0px_0px_20px_0px_rgba(30,41,59,1)] border-slate-700 bg-slate-900 hover:border-dashed"}`} transition-all p-0 my-24 mx-0 md:mx-24 relative flex flex-col justify-center items-center`}
                    onDragEnter={() => setDragging(true)}
                    onDragLeave={() => setDragging(false)}
                    onDragEnd={() => setDragging(false)}
                    onDrop={handleDrop}>
                    {filesSelected ? null : <input type="file" multiple onChange={(e) => setFilesRef([...e.target.files!!!])} className="absolute top-0 left-0 right-0 bottom-0 w-full h-full opacity-0 cursor-pointer" />}
                    <div className={`w-full h-full flex flex-col justify-center px-6 items-center py-16 ${filesSelected ? "" : "pointer-events-none"}`}>
                        {filesSelected ? null : <img src={fileUpload} className="h-28 mb-4 pointer-events-none" alt="file upload icon" />}
                        <p className="text-center text-slate-300 text-3xl font-bold mb-2 pointer-events-none">{filesSelected ? "Ready to share!" : "Drag & Drop"}</p>
                        {
                            filesSelected
                                ? <>
                                    <p className="text-center text-slate-400 text-sm pointer-events-none mt-1">Keep this page open to maintain the connection—closing it ends the session. Files are never stored on our servers.</p>
                                    <p className="text-center text-slate-400 text-sm pointer-events-none mb-8 mt-2">Share this link to give others access to your files!</p>
                                    <button
                                        className="w-full md:w-auto flex gap-4 items-center justify-between hover:cursor-pointer text-center bg-slate-300 text-slate-800 text-md md:text-lg border-2 rounded-xl py-4 px-8 border-slate-300 shadow-[0px_0px_10px_0px_rgba(148,163,184,0.4)]"
                                        onClick={async () => {
                                            const textToCopy = window.location.href

                                            if (navigator.clipboard && window.isSecureContext) {
                                                await navigator.clipboard.writeText(textToCopy);
                                            } else {
                                                const textArea = document.createElement("textarea");
                                                textArea.value = textToCopy;

                                                textArea.style.position = "absolute";
                                                textArea.style.left = "-999999px";

                                                document.body.prepend(textArea);
                                                textArea.select();

                                                try {
                                                    document.execCommand('copy');
                                                } catch (error) {
                                                    console.error(error);
                                                } finally {
                                                    textArea.remove();
                                                }
                                            }

                                            setCopied(true)
                                            setTimeout(() => setCopied(false), 5000)
                                        }}
                                    >
                                        <p className="whitespace-nowrap text-ellipsis overflow-hidden ">{`${window.location.href}`}</p>
                                        <FontAwesomeIcon className={`${copied ? "text-emerald-700" : "text-slate-900"} text-md md:text-lg`} icon={copied ? faClipboardCheck : faCopy} />
                                    </button>
                                </>
                                : <p className="text-center text-slate-400 text-sm pointer-events-none">or <span className="underline">choose a file</span></p>
                        }
                        {filesSelected ? null : <div className="flex-col md:flex-row mt-16 text-center text-slate-500 text-xs pointer-events-none"><p className='block md:inline'>No file size limits</p><span className='hidden md:inline'>&nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;</span><p className='block md:inline mt-1 md:mt-0'>No bandwidth restrictions</p></div>}
                    </div>
                </div >
            }
        </div >
    );
}
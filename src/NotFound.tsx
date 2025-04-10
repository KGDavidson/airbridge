import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function NotFound() {
    const navigate = useNavigate();

    useEffect(() => {
        setTimeout(() => navigate("/"), 5000)
    })

    return (
        <div className="p-8 space-y-4 bg-gray-900 min-h-screen w-screen flex flex-col justify-center items-center">
            <h1 className="text-6xl text-gray-100 font-bold">404</h1>
            <p className="text-lg text-gray-500">Page not found</p>
            <a
                href="/"
                className="mt-6 px-6 py-3 bg-slate-900 border-zinc-400 border-2 rounded-2xl text-white font-semibold hover:bg-slate-800 transition"
            >
                Go Home
            </a>
        </div>
    );
}

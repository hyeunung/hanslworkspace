import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function InitialLoadingScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1500); // 1.5초 후 페이드아웃
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white">
      <div className="relative w-[400px] h-[400px] flex items-center justify-center">
        <AnimatePresence>
          {visible && (
            <motion.div
              key="eng"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.7 } }}
              exit={{ opacity: 0, transition: { duration: 0.7 } }}
              className="absolute w-full h-full flex items-center justify-center"
            >
              <img
                src="/logo_eng.svg"
                alt="Hansl English Logo"
                width={400}
                height={400}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

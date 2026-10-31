import React, { useState } from 'react';
import { Icon } from './icons.jsx';

const ratingClass = (r) => (r >= 7 ? 'good' : r >= 5.5 ? 'mid' : 'bad');

// Постер с плавным появлением, когда картинка загрузилась
export function Poster({ src, className = '' }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={`poster ${className} ${ok ? 'loaded' : ''}`}>
      {src && (
        <img
          src={src}
          alt=""
          ref={(el) => el?.complete && el.naturalWidth && !ok && setOk(true)}
          onLoad={() => setOk(true)}
        />
      )}
    </div>
  );
}

export function Rating({ value }) {
  if (!(value > 0)) return null;
  return (
    <span className={`rating ${ratingClass(value)}`}>
      <Icon name="star" />
      {value.toFixed(1)}
    </span>
  );
}


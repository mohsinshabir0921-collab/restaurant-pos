import { IconSearch } from "./icons";

export default function SearchBox({ value, onChange, placeholder = "Search…", inputRef, ariaLabel, onKeyDown, onBlur }) {
  return (
    <div className="pos-search">
      <IconSearch size={15} className="pos-search-icon" />
      <input
        ref={inputRef}
        type="text"
        className="pos-search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        aria-label={ariaLabel || placeholder}
      />
      {value ? (
        <button
          type="button"
          className="pos-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

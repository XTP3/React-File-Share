import './SearchBar.css';

function SearchBar(props) {
    return (
        <div className="SearchBar">
            <ion-icon name="search-outline"></ion-icon>
            <input type="text" id="SearchInput" className="SearchInput" onChange={props.onChange} placeholder="Search"></input>
        </div>
    );
}

export default SearchBar;
import './CreateAccount.css';
import Config from '../Config';
import axios from 'axios';

const serverURL = Config.SERVER_URL;

function CreateAccount() {
    async function createNewAccount(event) {
        event.preventDefault();
        let accountCreationCodeInput = document.getElementById("CreationCodeInput").value;
        let usernameInput = document.getElementById("NewAccUsernameInput").value;
        let passwordInput = document.getElementById("NewAccPasswordInput").value;

        if(accountCreationCodeInput && usernameInput && passwordInput) {
            let url = serverURL + "/api/account/create";
            const response = await axios.post(url, {
                creationCode: accountCreationCodeInput,
                username: usernameInput,
                password: passwordInput
            });
            
            if(response.status === 201) {
                alert("Account Created Successfully!");
                
            }else {
                alert("Account Creation Failed!")
            }

        }else {
            alert("Invalid Input");
        }
    }

    return (
        <form className="CreateAccountForm" onSubmit={createNewAccount}>
            <div className="CreateAccount">
                <div className="NewAccInput code">
                    <input type="text" className="CreationCodeInput" id="CreationCodeInput" placeholder="Account Creation Code"></input>
                </div>
                <div className="NewAccInput username">
                    <input type="text" className="NewAccUsernameInput" id="NewAccUsernameInput" placeholder="Username"></input>
                </div>
                <div className="NewAccInput password">
                    <input type="password" className="NewAccPasswordInput" id="NewAccPasswordInput" placeholder="Password"></input>
                </div>
                <div className="NewAccInput submit">
                    <input type="submit" className="NewAccSubmitInput" value="Create"></input>
                </div>
            </div>
        </form>
    );
}

export default CreateAccount;